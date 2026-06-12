import Stripe from 'stripe';
import { DEBUG_PAYMENTS } from './pricing';
import { extractPaymentMethodFromSession, setDefaultPaymentMethodOnCustomerAndSubs } from './stripe-pm';
import { createMonthlyRecurringPriceDataItem } from './stripe-subscriptions';

/**
 * Shared helper to create the monthly service subscriptions for a completed
 * full (non-lease) order. Used by both the webhook (canonical) and the
 * /success fulfill path (fallback so users reliably see subs even if webhook
 * delivery is delayed or not configured in their dev setup).
 *
 * Idempotency: before creating, we check if a sub with matching order_session
 * metadata already exists for the customer. This prevents duplicates if both
 * webhook and success fire.
 */
export async function createFullServiceSubscriptions(
  stripe: Stripe,
  completedSession: Stripe.Checkout.Session,
  servicesArray: Array<{ name: string; price: number }>
) {
  const customerId = completedSession.customer as string | undefined;
  const orderId = completedSession.id;

  if (!customerId || servicesArray.length === 0) {
    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] createFullServiceSubscriptions: skipping (no customer or no services)', { customerId, servicesLen: servicesArray.length });
    }
    return;
  }

  // Idempotency check: look for an existing service sub for this order_session
  try {
    const existingSubs = await stripe.subscriptions.list({
      customer: customerId,
      limit: 20,
    });
    const alreadyCreated = existingSubs.data.some((sub: any) => {
      const meta = sub.metadata || {};
      return meta.order_session === orderId && meta.service; // has service meta => one of ours
    });
    if (alreadyCreated) {
      console.log(`[PAYMENT DEBUG] createFullServiceSubscriptions: subs already exist for order ${orderId}, skipping creation`);
      return;
    }
  } catch (e) {
    console.warn('Could not check for existing service subs (will proceed)', e);
  }

  if (DEBUG_PAYMENTS) {
    console.log('[PAYMENT DEBUG] createFullServiceSubscriptions starting for', orderId, 'services:', servicesArray.length);
  }

  // PM extraction + attach now delegated to shared helpers (see lib/stripe-pm.ts)
  const defaultPaymentMethod = await extractPaymentMethodFromSession(stripe, completedSession);

  if (!defaultPaymentMethod) {
    console.warn(`No usable default PM found for full services on ${orderId} (creating subs with default_incomplete so they are visible). customer=${customerId} services=${servicesArray.length}`);
  } else if (DEBUG_PAYMENTS) {
    console.log('[PAYMENT DEBUG] fulfill/full services: using defaultPaymentMethod=', defaultPaymentMethod);
  }

  if (defaultPaymentMethod) {
    await setDefaultPaymentMethodOnCustomerAndSubs(stripe, customerId, defaultPaymentMethod);
  }

  // For the uniform "recurring starts exactly 1 month after order time" rule,
  // we set trial_end based on the order_placed_at from metadata (if present).
  // This achieves the delayed start for full+card/sepa services and hybrid recurring,
  // using the order time rather than creation time (no special cases).
  // trial_end is the reliable way to delay first charge by ~1mo for monthly subs.
  const meta = (completedSession as any).metadata || {};
  const orderTs = meta.order_placed_at ? parseInt(meta.order_placed_at, 10) : null;
  const servicesTrialEnd = orderTs ? orderTs + 32 * 24 * 3600 : null;

  // Support for hybrid "pay by invoice (hardware) + recurring services by card/sepa (setup)" path:
  // The service subs are now pre-created in the checkout route (for visibility right after order,
  // before/during the setup trip to collect the PM "numbers"). On setup completion (webhook or fulfill),
  // we attach the collected PM instead of creating new subs.
  const preSubIdsStr = meta.service_subscription_ids || meta.serviceSubscriptionIds;
  if (preSubIdsStr) {
    let preIds: string[] = [];
    try { preIds = JSON.parse(preSubIdsStr); } catch {}
    for (const preId of preIds) {
      if (defaultPaymentMethod) {
        try {
          await stripe.subscriptions.update(preId, {
            default_payment_method: defaultPaymentMethod,
          });
          console.log(`Attached PM to pre-created service sub ${preId} (hybrid invoice + recurring auto via setup)`);
        } catch (attachErr) {
          console.warn('Failed to attach PM to pre-created hybrid service sub', preId, attachErr);
        }
      }
    }
    return;
  }

  for (const svc of servicesArray) {
    try {
      const item = await createMonthlyRecurringPriceDataItem(stripe, svc.name, svc.price);

      const subParams: any = {
        customer: customerId,
        collection_method: 'charge_automatically',
        items: [item],
        metadata: {
          order_session: orderId,
          service: svc.name,
          ...(orderTs && { order_placed_at: orderTs.toString() }),
        },
      };
      if (servicesTrialEnd) {
        subParams.trial_end = servicesTrialEnd;
      }
      if (defaultPaymentMethod) {
        subParams.default_payment_method = defaultPaymentMethod;
      } else {
        subParams.payment_behavior = 'default_incomplete';
      }

      if (DEBUG_PAYMENTS) {
        console.log('[PAYMENT DEBUG] (fulfill) creating service sub for', svc.name, 'hasDefaultPM=', !!subParams.default_payment_method, 'hasPaymentBehavior=', !!subParams.payment_behavior, 'hasTrial=', !!servicesTrialEnd);
      }

      const createdSub = await stripe.subscriptions.create(subParams);

      if (defaultPaymentMethod) {
        try {
          await stripe.subscriptions.update(createdSub.id, {
            default_payment_method: defaultPaymentMethod,
          });
        } catch (reapplyErr) {
          console.warn(`Could not re-apply default PM to service sub ${createdSub.id} (fulfill)`, reapplyErr);
        }
      }

      console.log(`Created service subscription ${createdSub.id} for "${svc.name}" on customer ${customerId} (pm: ${defaultPaymentMethod || 'none; used default_incomplete for visibility'})`);

      // Diagnostic first invoice
      try {
        const firstInv = (createdSub as any).latest_invoice;
        const invId = typeof firstInv === 'string' ? firstInv : firstInv?.id;
        if (invId) {
          const inv = await stripe.invoices.retrieve(invId);
          console.log(`  First invoice ${invId} for sub ${createdSub.id}: status=${inv.status}, paid=${inv.paid}, amount_paid=${inv.amount_paid}`);
        }
      } catch (invLogErr) {
        console.warn('Could not retrieve first service invoice for logging (fulfill)', invLogErr);
      }
    } catch (subErr: any) {
      const msg = (subErr?.message || '').toLowerCase();
      if (msg.includes('default payment') || msg.includes('no attached') || msg.includes('payment source')) {
        console.warn(`Service sub create for "${svc.name}" hit no-default; re-setting and retrying once`);
        if (defaultPaymentMethod && customerId) {
          try {
            await stripe.customers.update(customerId, {
              invoice_settings: { default_payment_method: defaultPaymentMethod },
            });
          } catch {}
        }
        try {
          const item2 = await createMonthlyRecurringPriceDataItem(stripe, svc.name, svc.price);
          const subParams2: any = {
            customer: customerId,
            collection_method: 'charge_automatically',
            items: [item2],
            metadata: { order_session: orderId, service: svc.name, ...(orderTs && { order_placed_at: orderTs.toString() }) },
          };
          if (servicesTrialEnd) {
            subParams2.trial_end = servicesTrialEnd;
          }
          if (defaultPaymentMethod) {
            subParams2.default_payment_method = defaultPaymentMethod;
          } else {
            subParams2.payment_behavior = 'default_incomplete';
          }
          const retriedSub = await stripe.subscriptions.create(subParams2);

          if (defaultPaymentMethod) {
            try {
              await stripe.subscriptions.update(retriedSub.id, {
                default_payment_method: defaultPaymentMethod,
              });
            } catch (reapplyErr) {
              console.warn(`Could not re-apply default PM to retried service sub ${retriedSub.id} (fulfill)`, reapplyErr);
            }
          }

          console.log(`Retry succeeded for service sub ${retriedSub.id} "${svc.name}" on customer ${customerId}`);
        } catch (retryErr) {
          console.error('Retry also failed (fulfill) for service subscription', retryErr);
        }
      } else {
        console.error('Failed to create service subscription', subErr);
      }
    }
  }

  // Re-set customer default after the loop
  if (defaultPaymentMethod && customerId) {
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: defaultPaymentMethod },
      });
    } catch (custErr) {
      console.warn('Could not re-set default pm on customer after service subs (fulfill)', custErr);
    }
  }
}
