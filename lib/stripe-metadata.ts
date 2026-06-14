/**
 * Helpers to build the very repetitive Stripe metadata objects we attach to
 * Customers, Checkout Sessions, Invoices, Subscriptions, etc.
 *
 * Without this we repeat the same 10-15 keys (B2B company/vat/po, address JSON,
 * services JSON, pricing_version, locale, order_placed_at, financing, lease_*
 * fields, contract_type, etc.) in 20+ places.
 */

export interface OrderMetadataInput {
  company?: string;
  vatNumber?: string;
  poNumber?: string;
  address?: string;
  city?: string;
  postal?: string;
  country?: string;

  financing?: 'full' | 'lease' | string;
  services?: Array<{ name: string; price: number }>;
  pricingVersion: string;
  locale?: string;
  orderPlacedAt?: number | string;

  // Lease / contract specific (passed through)
  contractType?: string;
  leaseMonths?: number | string;
  leaseCancelAt?: number | string;
  leaseUpfrontAmount?: number | string;
  leaseMonthlyAmount?: number | string;
  leaseFinancedAmount?: number | string;

  // Any additional fields (is_*, main_invoice_id, recurring_payment_method, etc.)
  [key: string]: unknown;

  // VAT treatment / choice (added for professional customer VAT-inclusive election feature).
  // These are passed through to metadata for full auditability + tax compliance records.
  // See lib/vat.ts for determination rules. Never mutate pricing base values.
  vat_inclusive_choice?: string;
  vat_treatment?: string;
  vat_rate?: string | number;
  net_total?: string | number;
  vat_amount?: string | number;
  gross_total?: string | number;
  vat_determination_reason?: string;
  vat_number_validated?: string;
  vat_charged?: string;
}

export function buildB2BMetadata(input: Pick<OrderMetadataInput, 'company' | 'vatNumber' | 'poNumber'>) {
  return {
    company_name: input.company || 'N/A',
    vat_number: input.vatNumber || 'N/A',
    po_number: input.poNumber || 'N/A',
  };
}

export function buildAddressJson(input: Pick<OrderMetadataInput, 'address' | 'city' | 'postal' | 'country'>) {
  if (!input.address && !input.city && !input.postal && !input.country) return {};
  return {
    address: JSON.stringify({
      address: input.address || '',
      city: input.city || '',
      postal: input.postal || '',
      country: input.country || '',
    }),
  };
}

/**
 * Main helper. Returns a metadata object suitable for Stripe (Sessions, Invoices, Subs, etc.).
 * All the boring repeated B2B + order fields are centralized here.
 * Extra/lease-specific fields are passed through.
 */
export function buildOrderMetadata(input: OrderMetadataInput): Record<string, string> {
  const meta: Record<string, string> = {
    ...buildB2BMetadata(input),
    ...buildAddressJson(input),
    pricing_version: input.pricingVersion,
    locale: input.locale || 'en',
  };

  if (input.financing) meta.financing = input.financing;
  if (input.services) {
    meta.services = JSON.stringify(input.services);  // always include, even as '[]' (tests + downstream expect it)
  }
  if (input.orderPlacedAt != null) {
    meta.order_placed_at = String(input.orderPlacedAt);
  }
  if (input.contractType) meta.contract_type = input.contractType;

  // Lease fields (only include if truthy to keep objects smaller)
  if (input.leaseMonths != null) meta.lease_months = String(input.leaseMonths);
  if (input.leaseCancelAt != null) meta.lease_cancel_at = String(input.leaseCancelAt);
  if (input.leaseUpfrontAmount != null) meta.lease_upfront_amount = String(input.leaseUpfrontAmount);
  if (input.leaseMonthlyAmount != null) meta.lease_monthly_amount = String(input.leaseMonthlyAmount);
  if (input.leaseFinancedAmount != null) meta.lease_financed_amount = String(input.leaseFinancedAmount);

  // Pass through any other caller-provided keys (is_lease_*, recurring_*, main_invoice_id, etc.)
  for (const [k, v] of Object.entries(input)) {
    if (
      v != null &&
      !['company','vatNumber','poNumber','address','city','postal','country',
        'financing','services','pricingVersion','locale','orderPlacedAt',
        'contractType','leaseMonths','leaseCancelAt','leaseUpfrontAmount',
        'leaseMonthlyAmount','leaseFinancedAmount'
      ].includes(k)
    ) {
      meta[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
  }

  return meta;
}
