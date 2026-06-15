import Stripe from 'stripe';

export interface AddressFields {
  address?: string;
  city?: string;
  postal?: string;
  country?: string;
}

export interface B2BCustomerParams {
  email: string;
  company?: string;
  vatNumber?: string;
  poNumber?: string;
  address?: string;
  city?: string;
  postal?: string;
  country?: string;
  /** Delivery/shipping address (shown on Stripe invoices when different from billing). */
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryPostal?: string;
  deliveryCountry?: string;
}

/** Normalize country for Stripe (ISO 3166-1 alpha-2). "other" is not valid. */
export function stripeCountryCode(country?: string): string | undefined {
  if (!country || country === 'other') return undefined;
  return country;
}

export function buildStripeAddress(fields: AddressFields): Stripe.AddressParam | undefined {
  const line1 = fields.address?.trim();
  const city = fields.city?.trim();
  const postal_code = fields.postal?.trim();
  const country = stripeCountryCode(fields.country);

  if (!line1 && !city && !postal_code && !country) return undefined;

  return {
    line1: line1 || undefined,
    city: city || undefined,
    postal_code: postal_code || undefined,
    country: country || undefined,
  };
}

export function resolveDeliveryAddress(params: AddressFields & {
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryPostal?: string;
  deliveryCountry?: string;
}): AddressFields {
  const hasSeparateDelivery =
    !!params.deliveryAddress?.trim() ||
    !!params.deliveryCity?.trim() ||
    !!params.deliveryPostal?.trim() ||
    !!(params.deliveryCountry && params.deliveryCountry !== params.country);

  if (hasSeparateDelivery) {
    return {
      address: params.deliveryAddress,
      city: params.deliveryCity,
      postal: params.deliveryPostal,
      country: params.deliveryCountry || params.country,
    };
  }

  return {
    address: params.address,
    city: params.city,
    postal: params.postal,
    country: params.country,
  };
}

/**
 * Creates a Stripe Customer explicitly with B2B metadata and address.
 *
 * Purpose (centralized):
 * - We "own" the customer record in Stripe (instead of only customer_email on sessions/invoices).
 * - Rich metadata (company, VAT, PO) for reconciliation.
 * - Structured address so hosted Checkout / invoices prefill billing details.
 * - Shipping address (delivery) so both appear on Stripe invoices.
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
    deliveryAddress,
    deliveryCity,
    deliveryPostal,
    deliveryCountry,
  } = params;

  const billingAddress = buildStripeAddress({ address, city, postal, country });
  const shippingFields = resolveDeliveryAddress({
    address,
    city,
    postal,
    country,
    deliveryAddress,
    deliveryCity,
    deliveryPostal,
    deliveryCountry,
  });
  const shippingAddress = buildStripeAddress(shippingFields);

  const customerParams: Stripe.CustomerCreateParams = {
    email,
    name: company || undefined,
    metadata: {
      company_name: company || 'N/A',
      vat_number: vatNumber || 'N/A',
      po_number: poNumber || 'N/A',
    },
  };

  if (billingAddress) {
    customerParams.address = billingAddress;
  }

  if (shippingAddress) {
    customerParams.shipping = {
      name: company || undefined,
      address: shippingAddress,
    };
  }

  const customer = await stripe.customers.create(customerParams);

  return customer.id;
}

/** Shipping details shape for Stripe Invoices (billing uses customer.address). */
export function buildInvoiceShippingDetails(
  params: Pick<B2BCustomerParams, 'company' | 'address' | 'city' | 'postal' | 'country' | 'deliveryAddress' | 'deliveryCity' | 'deliveryPostal' | 'deliveryCountry'>
): Stripe.InvoiceCreateParams.ShippingDetails | undefined {
  const shippingFields = resolveDeliveryAddress(params);
  const shippingAddress = buildStripeAddress(shippingFields);
  if (!shippingAddress) return undefined;

  return {
    name: params.company || undefined,
    address: shippingAddress,
  };
}