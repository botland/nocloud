import Stripe from 'stripe';

export interface B2BCustomerParams {
  email: string;
  company?: string;
  vatNumber?: string;
  poNumber?: string;
  address?: string;
  city?: string;
  postal?: string;
  country?: string;
}

/**
 * Creates a Stripe Customer explicitly with B2B metadata and address.
 *
 * Purpose (centralized):
 * - We "own" the customer record in Stripe (instead of only customer_email on sessions/invoices).
 * - Rich metadata (company, VAT, PO) for reconciliation.
 * - Structured address so hosted Checkout / invoices prefill billing details.
 *
 * This helper is intentionally small and pure on the Stripe shape.
 * Callers decide:
 *   - whether email is required
 *   - error handling (warn+proceed vs hard failure + 5xx)
 *
 * Used by /api/checkout for the three main financing paths.
 */
export async function createB2BStripeCustomer(
  stripe: Stripe,
  params: B2BCustomerParams
): Promise<string> {
  const {
    email,
    company,
    vatNumber,
    poNumber,
    address,
    city,
    postal,
    country,
  } = params;

  const customer = await stripe.customers.create({
    email,
    name: company || undefined,
    address: {
      line1: address || undefined,
      city: city || undefined,
      postal_code: postal || undefined,
      country: country || undefined,
    },
    metadata: {
      company_name: company || 'N/A',
      vat_number: vatNumber || 'N/A',
      po_number: poNumber || 'N/A',
    },
  });

  return customer.id;
}
