import Stripe from 'stripe';
import { DEBUG_PAYMENTS } from './pricing';
import { extractPaymentMethodFromSession, setDefaultPaymentMethodOnCustomerAndSubs } from './stripe-pm';
import {
  createMonthlyRecurringPriceDataItem,
  createPhasedMonthlySubscription,
} from './stripe-subscriptions';
import {
  parseServicesFromMetadata,
  serviceSubscriptionMetadata,
  serviceSubscriptionProductInfo,
  type ServiceInstance,
} from './product-instances';
import { isBeforeUtcDate, launchFreeUntilEpoch, promoPhaseEndEpoch } from './promotions';

export type ServiceForSubscription = ServiceInstance;

/** Parse compact `services` metadata from checkout / invoice. */
export function servicesFromOrderMetadata(
  servicesJson: string | undefined,
  pricingVersion: string,
): ServiceForSubscription[] {
  if (!servicesJson) return [];
  try {
    return parseServicesFromMetadata(servicesJson, pricingVersion);
  } catch {
    return [];
  }
}

export type CreateRecurringServiceSubOptions = {
  grossUnit?: (net: number) => number;
  collection_method?: 'charge_automatically' | 'send_invoice';
  trial_end?: number;
  days_until_due?: number;
  payment_behavior?: 'default_incomplete';
  default_payment_method?: string;
  metadata?: Record<string, string>;
  expand?: string[];
};

/**
 * Create one monthly recurring subscription for a single service instance.
 * Product name, description, and metadata carry product_line_id and host serial for invoices.
 */
function hasActiveTierPromo(service: ServiceInstance): boolean {
  return (
    !!service.promoEndsAt &&
    service.price < service.listPrice &&
    !service.launchFreeUntil
  );
}

export async function createRecurringServiceSubscription(
  stripe: Stripe,
  customerId: string,
  service: ServiceInstance,
  options: CreateRecurringServiceSubOptions = {},
): Promise<Stripe.Subscription> {
  const gross = options.grossUnit ?? ((n: number) => n);
  const productInfo = serviceSubscriptionProductInfo(service);
  const launchActive =
    !!service.launchFreeUntil && isBeforeUtcDate(service.launchFreeUntil);
  const tierPromoActive = hasActiveTierPromo(service);

  let trialEnd = options.trial_end;
  if (launchActive && service.launchFreeUntil) {
    trialEnd = launchFreeUntilEpoch(service.launchFreeUntil);
  }

  const subMetadata = {
    ...serviceSubscriptionMetadata(service, options.metadata),
    ...(launchActive && service.launchFreeUntil
      ? { launch_free_until: service.launchFreeUntil }
      : {}),
  };

  const productMetadata = {
    ...productInfo.metadata,
    ...(launchActive
      ? {
          launch_free_until: service.launchFreeUntil!,
          launch_list_price: String(service.listPrice),
        }
      : {}),
  };

  if (tierPromoActive && service.promoEndsAt) {
    const promoEnd = promoPhaseEndEpoch(service.promoEndsAt);
    const billingStart = trialEnd ?? Math.floor(Date.now() / 1000);

    if (billingStart < promoEnd) {
      return createPhasedMonthlySubscription(stripe, customerId, {
        productName: productInfo.name,
        productDescription: productInfo.description,
        productMetadata,
        promoAmountEur: gross(service.price),
        listAmountEur: gross(service.listPrice),
        promoPhaseEndEpoch: promoEnd,
        trialEnd,
        metadata: subMetadata,
        collection_method: options.collection_method,
        days_until_due: options.days_until_due,
        payment_behavior: options.payment_behavior,
        default_payment_method: options.default_payment_method,
        expand: options.expand,
      });
    }
  }

  const billableMonthly = launchActive
    ? (service.listPrice ?? service.price)
    : tierPromoActive
      ? service.listPrice
      : service.price;

  const item = await createMonthlyRecurringPriceDataItem(
    stripe,
    productInfo.name,
    gross(billableMonthly),
    {
      description: productInfo.description,
      metadata: productMetadata,
    },
  );

  const subParams: Stripe.SubscriptionCreateParams = {
    customer: customerId,
    items: [item],
    metadata: subMetadata,
    ...(options.collection_method ? { collection_method: options.collection_method } : {}),
    ...(trialEnd ? { trial_end: trialEnd } : {}),
    ...(options.days_until_due ? { days_until_due: options.days_until_due } : {}),
    ...(options.payment_behavior ? { payment_behavior: options.payment_behavior } : {}),
    ...(options.default_payment_method
      ? { default_payment_method: options.default_payment_method }
      : {}),
    ...(options.expand ? { expand: options.expand } : {}),
  };

  return stripe.subscriptions.create(subParams);
}

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
  servicesInput: ServiceInstance[] | string,
  pricingVersion?: string,
) {
  const customerId = completedSession.customer as string | undefined;
  const orderId = completedSession.id;
  const meta = (completedSession as any).metadata || {};
  const version = pricingVersion || meta.pricing_version || meta.pricingVersion || 'unknown';

  const servicesArray: ServiceInstance[] =
    typeof servicesInput === 'string'
      ? servicesFromOrderMetadata(servicesInput, version)
      : servicesInput;

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
      const subMeta = sub.metadata || {};
      return subMeta.order_session === orderId && subMeta.service;
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

  const defaultPaymentMethod = await extractPaymentMethodFromSession(stripe, completedSession);

  if (!defaultPaymentMethod) {
    console.warn(`No usable default PM found for full services on ${orderId} (creating subs with default_incomplete so they are visible). customer=${customerId} services=${servicesArray.length}`);
  } else if (DEBUG_PAYMENTS) {
    console.log('[PAYMENT DEBUG] fulfill/full services: using defaultPaymentMethod=', defaultPaymentMethod);
  }

  if (defaultPaymentMethod) {
    await setDefaultPaymentMethodOnCustomerAndSubs(stripe, customerId, defaultPaymentMethod);
  }

  const orderTs = meta.order_placed_at ? parseInt(meta.order_placed_at, 10) : null;
  const servicesTrialEnd = orderTs ? orderTs + 32 * 24 * 3600 : null;

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
      const subParams: CreateRecurringServiceSubOptions = {
        collection_method: 'charge_automatically',
        metadata: {
          order_session: orderId,
          ...(orderTs && { order_placed_at: orderTs.toString() }),
        },
        ...(servicesTrialEnd ? { trial_end: servicesTrialEnd } : {}),
        ...(defaultPaymentMethod
          ? { default_payment_method: defaultPaymentMethod }
          : { payment_behavior: 'default_incomplete' }),
      };

      if (DEBUG_PAYMENTS) {
        console.log('[PAYMENT DEBUG] (fulfill) creating service sub for', svc.name, 'host=', svc.hostSerialNumber, 'hasDefaultPM=', !!defaultPaymentMethod, 'hasTrial=', !!servicesTrialEnd);
      }

      const createdSub = await createRecurringServiceSubscription(stripe, customerId, svc, subParams);

      if (defaultPaymentMethod) {
        try {
          await stripe.subscriptions.update(createdSub.id, {
            default_payment_method: defaultPaymentMethod,
          });
        } catch (reapplyErr) {
          console.warn(`Could not re-apply default PM to service sub ${createdSub.id} (fulfill)`, reapplyErr);
        }
      }

      console.log(`Created service subscription ${createdSub.id} for "${svc.name}" (S/N ${svc.hostSerialNumber}) on customer ${customerId} (pm: ${defaultPaymentMethod || 'none; used default_incomplete for visibility'})`);

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
          const retriedSub = await createRecurringServiceSubscription(stripe, customerId, svc, {
            collection_method: 'charge_automatically',
            metadata: {
              order_session: orderId,
              ...(orderTs && { order_placed_at: orderTs.toString() }),
            },
            ...(servicesTrialEnd ? { trial_end: servicesTrialEnd } : {}),
            ...(defaultPaymentMethod
              ? { default_payment_method: defaultPaymentMethod }
              : { payment_behavior: 'default_incomplete' }),
          });

          if (defaultPaymentMethod) {
            try {
              await stripe.subscriptions.update(retriedSub.id, {
                default_payment_method: defaultPaymentMethod,
              });
            } catch (reapplyErr) {
              console.warn(`Could not re-apply default PM to retried service sub ${retriedSub.id} (fulfill)`, reapplyErr);
            }
          }

          console.log(`Retry succeeded for service sub ${retriedSub.id} "${svc.name}" (S/N ${svc.hostSerialNumber}) on customer ${customerId}`);
        } catch (retryErr) {
          console.error('Retry also failed (fulfill) for service subscription', retryErr);
        }
      } else {
        console.error('Failed to create service subscription', subErr);
      }
    }
  }

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