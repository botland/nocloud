import Stripe from 'stripe';

/**
 * Create a Stripe Customer Billing Portal session URL so the customer can update
 * their payment method. Requires Billing Portal to be configured in Stripe Dashboard.
 */
export async function createPaymentMethodUpdateUrl(
  stripe: Stripe,
  customerId: string,
  returnUrl?: string,
): Promise<string> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080';
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl || siteUrl,
  });
  if (!session.url) {
    throw new Error('Billing Portal session created without URL — check Stripe Dashboard configuration');
  }
  return session.url;
}