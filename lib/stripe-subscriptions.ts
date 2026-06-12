import Stripe from 'stripe';

/**
 * Small helper to reduce the repeated "create a dynamic Product then a
 * recurring monthly price_data item for it" pattern that appears for
 * every service sub and every lease hardware sub.
 */
export async function createMonthlyRecurringPriceDataItem(
  stripe: Stripe,
  name: string,
  unitAmountEur: number,
  extraPriceData: Record<string, any> = {}
) {
  const product = await stripe.products.create({ name });

  return {
    price_data: {
      currency: 'eur',
      product: product.id,
      unit_amount: Math.round(unitAmountEur * 100),
      recurring: { interval: 'month' },
      ...extraPriceData,
    },
  };
}
