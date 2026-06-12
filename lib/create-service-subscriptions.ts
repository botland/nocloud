import Stripe from 'stripe';
import { DEBUG_PAYMENTS } from './pricing';

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

  // PM extraction - robust logic supporting both classic payment-mode sessions (hardware one-time)
  // and the new mode:'setup' sessions used for the hybrid "invoice for hardware + card/sepa for recurring services" flow.
  // We expand both payment_intent and setup_intent so the helper works for either.
  let defaultPaymentMethod: string | undefined;

  // Try to get from the session if expanded, or re-retrieve (now expanding both kinds of intent)
  let sessionForPm: any = completedSession;
  const needsReRetrieve = !completedSession.payment_intent || typeof completedSession.payment_intent === 'string'
    || !completedSession.setup_intent || typeof completedSession.setup_intent === 'string';
  if (needsReRetrieve) {
    try {
      sessionForPm = await stripe.checkout.sessions.retrieve(completedSession.id, {
        expand: ['payment_intent.payment_method', 'setup_intent.payment_method'],
      });
    } catch (e) {
      console.warn('Could not re-retrieve session for PM in fulfill path', e);
    }
  }

  const s = sessionForPm;
  const sessionPm = (s as any).payment_method as string | undefined;
  if (sessionPm) {
    defaultPaymentMethod = sessionPm;
  }

  if (!defaultPaymentMethod) {
    // Support either a payment_intent (classic full + card/sepa) or a setup_intent (hybrid invoice + recurring auto)
    let intent: any = s.payment_intent || s.setup_intent;
    const intentId = typeof intent === 'string' ? intent : (intent && intent.id);
    if (intentId) {
      try {
        const isSetup = !!s.setup_intent || (intent && (intent.object === 'setup_intent' || (typeof intent === 'object' && !intent.client_secret /*heuristic*/)));
        if (isSetup) {
          const retrievedSi = await stripe.setupIntents.retrieve(intentId, { expand: ['payment_method'] });
          const pm = (retrievedSi as any).payment_method;
          const candidate = typeof pm === 'string' ? pm : pm?.id;
          if (candidate) defaultPaymentMethod = candidate;
        } else {
          const retrievedPi = await stripe.paymentIntents.retrieve(intentId, { expand: ['payment_method'] });
          const pm = (retrievedPi as any).payment_method;
          const candidate = typeof pm === 'string' ? pm : pm?.id;
          if (candidate) defaultPaymentMethod = candidate;
        }
      } catch (retrieveErr) {
        console.warn('Could not expand payment_intent/setup_intent to obtain payment_method for service subs', retrieveErr);
      }
    }
  }

  if (!defaultPaymentMethod && s.customer) {
    try {
      const pms = await stripe.customers.listPaymentMethods(s.customer as string, { limit: 5 });
      const recent = pms.data.find((p: any) => p.type === 'card' || p.type === 'sepa_debit');
      if (recent?.id) defaultPaymentMethod = recent.id;
    } catch (listErr) {
      console.warn('Could not list recent PMs for service subs', listErr);
    }
  }

  if (!defaultPaymentMethod) {
    console.warn(`No usable default PM found for full services on ${orderId} (creating subs with default_incomplete so they are visible). customer=${customerId} services=${servicesArray.length}`);
  } else if (DEBUG_PAYMENTS) {
    console.log('[PAYMENT DEBUG] fulfill/full services: using defaultPaymentMethod=', defaultPaymentMethod);
  }

  // Set as customer's default (before creations)
  if (defaultPaymentMethod) {
    try {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: defaultPaymentMethod },
      });
    } catch (custErr) {
      console.warn('Could not set default pm on customer (fulfill path)', custErr);
    }
  }

  for (const svc of servicesArray) {
    try {
      const serviceProduct = await stripe.products.create({
        name: svc.name,
      });

      const subParams: any = {
        customer: customerId,
        collection_method: 'charge_automatically',
        items: [{
          price_data: {
            currency: 'eur',
            product: serviceProduct.id,
            unit_amount: Math.round(svc.price * 100),
            recurring: { interval: 'month' },
          } as any,
        }],
        metadata: {
          order_session: orderId,
          service: svc.name,
        },
      };
      if (defaultPaymentMethod) {
        subParams.default_payment_method = defaultPaymentMethod;
      } else {
        subParams.payment_behavior = 'default_incomplete';
      }

      if (DEBUG_PAYMENTS) {
        console.log('[PAYMENT DEBUG] (fulfill) creating service sub for', svc.name, 'hasDefaultPM=', !!subParams.default_payment_method, 'hasPaymentBehavior=', !!subParams.payment_behavior);
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
          const serviceProduct2 = await stripe.products.create({ name: svc.name });
          const subParams2: any = {
            customer: customerId,
            collection_method: 'charge_automatically',
            items: [{
              price_data: {
                currency: 'eur',
                product: serviceProduct2.id,
                unit_amount: Math.round(svc.price * 100),
                recurring: { interval: 'month' },
              } as any,
            }],
            metadata: { order_session: orderId, service: svc.name },
          };
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
