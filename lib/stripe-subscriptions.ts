import Stripe from 'stripe';

export type MonthlyRecurringProductOptions = {
  description?: string;
  metadata?: Record<string, string>;
};

/**
 * Create a Product and recurring monthly Price; returns stable Price IDs for schedules.
 */
export async function createMonthlyRecurringPrice(
  stripe: Stripe,
  name: string,
  unitAmountEur: number,
  options?: MonthlyRecurringProductOptions & { productId?: string },
): Promise<{ productId: string; priceId: string }> {
  const productId =
    options?.productId ||
    (
      await stripe.products.create({
        name,
        description: options?.description,
        metadata: options?.metadata,
      })
    ).id;

  const price = await stripe.prices.create({
    currency: 'eur',
    product: productId,
    unit_amount: Math.round(unitAmountEur * 100),
    recurring: { interval: 'month' as const },
    nickname: name,
  });

  return { productId, priceId: price.id };
}

/**
 * Small helper to reduce the repeated "create a dynamic Product then a
 * recurring monthly price_data item for it" pattern that appears for
 * every service sub and every lease hardware sub.
 */
export async function createMonthlyRecurringPriceDataItem(
  stripe: Stripe,
  name: string,
  unitAmountEur: number,
  options?: MonthlyRecurringProductOptions & { extraPriceData?: Record<string, unknown> },
): Promise<Stripe.SubscriptionCreateParams.Item> {
  const product = await stripe.products.create({
    name,
    description: options?.description,
    metadata: options?.metadata,
  });

  const serial = options?.metadata?.serial_number || options?.metadata?.host_serial_number;
  return {
    price_data: {
      currency: 'eur',
      product: product.id,
      unit_amount: Math.round(unitAmountEur * 100),
      recurring: { interval: 'month' as const },
      ...(serial ? { nickname: name } : {}),
      ...(options?.extraPriceData || {}),
    },
  };
}

export type PhasedSubscriptionOptions = {
  productName: string;
  productDescription?: string;
  productMetadata?: Record<string, string>;
  promoAmountEur: number;
  listAmountEur: number;
  promoPhaseEndEpoch: number;
  trialEnd?: number;
  metadata?: Record<string, string>;
  collection_method?: Stripe.SubscriptionCreateParams.CollectionMethod;
  days_until_due?: number;
  payment_behavior?: Stripe.SubscriptionCreateParams.PaymentBehavior;
  default_payment_method?: string;
  expand?: string[];
};

/**
 * Subscription schedule: promotional monthly rate until promoPhaseEndEpoch, then catalog list rate.
 * Phase 1 may include trial_end (e.g. order-delay billing); billing at promo rate starts after trial.
 */
export async function createPhasedMonthlySubscription(
  stripe: Stripe,
  customerId: string,
  options: PhasedSubscriptionOptions,
): Promise<Stripe.Subscription> {
  const product = await stripe.products.create({
    name: options.productName,
    description: options.productDescription,
    metadata: options.productMetadata,
  });

  const [promoPrice, listPrice] = await Promise.all([
    stripe.prices.create({
      currency: 'eur',
      product: product.id,
      unit_amount: Math.round(options.promoAmountEur * 100),
      recurring: { interval: 'month' as const },
      nickname: `${options.productName} (promo)`,
    }),
    stripe.prices.create({
      currency: 'eur',
      product: product.id,
      unit_amount: Math.round(options.listAmountEur * 100),
      recurring: { interval: 'month' as const },
      nickname: `${options.productName} (list)`,
    }),
  ]);
  const promoPriceId = promoPrice.id;
  const listPriceId = listPrice.id;

  const phase1: Stripe.SubscriptionScheduleCreateParams.Phase = {
    items: [{ price: promoPriceId, quantity: 1 }],
    end_date: options.promoPhaseEndEpoch,
    ...(options.trialEnd ? { trial_end: options.trialEnd } : {}),
  };
  const phase2: Stripe.SubscriptionScheduleCreateParams.Phase = {
    items: [{ price: listPriceId, quantity: 1 }],
  };

  const schedule = await stripe.subscriptionSchedules.create({
    customer: customerId,
    end_behavior: 'release',
    phases: [phase1, phase2],
    metadata: options.metadata,
    default_settings: {
      ...(options.collection_method ? { collection_method: options.collection_method } : {}),
      ...(options.default_payment_method
        ? { default_payment_method: options.default_payment_method }
        : {}),
      ...(options.days_until_due ? { invoice_settings: { days_until_due: options.days_until_due } } : {}),
    },
    ...(options.expand ? { expand: options.expand.map((e) => `subscription.${e}`) } : {}),
  });

  const subRef = schedule.subscription;
  if (typeof subRef === 'string') {
    return stripe.subscriptions.retrieve(subRef, {
      expand: options.expand,
    });
  }
  return subRef as Stripe.Subscription;
}
