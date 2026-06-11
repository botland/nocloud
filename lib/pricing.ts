/**
 * lib/pricing.ts
 *
 * Single source of truth for *all* price-related data, thresholds, and calculations.
 *
 * - Hardware appliance one-time prices (EUR).
 * - Optional recurring service monthly prices (EUR).
 * - Lease rules:
 *     - LEASE_MAX / LEASE_MIN: hardware value range eligible for leasing
 *     - UPFRONT_PERCENT: % of hardware charged upfront when leasing (reduces financed principal)
 *     - LEASE_THRESHOLD / LEASE_MONTHS_*: term length (12mo under threshold, 24mo at/above)
 * - SEPA payment method cap (Stripe limit we enforce client + server).
 * - Invoice policy: when INVOICE_ONLY_FULL_NO_SERVICES is true, "Pay by Invoice (B2B)"
 *   is restricted to financing='full' with no recurring services (reduces admin work for net-30).
 * - PRICING_VERSION: recorded in Stripe metadata + emails for audit when prices/rules change over time.
 *
 * Philosophy for price changes over time:
 * - Edit values here + bump PRICING_VERSION => affects *new* configurator/cart/checkout immediately.
 * - Existing customer subscriptions (created with inline price_data at the time of purchase,
 *   or the lease subscription amount) keep the exact rate/amount they were sold at.
 *   Stripe records the transacted unit_amount; our code owns the *current* definition.
 * - This keeps us in control of the catalog (less provider lock-in) while still using Stripe
 *   for payments, customers, and historical rate enforcement.
 *
 * All client previews and server line_items/metadata must derive from these values
 * (ensures consistency and eliminates duplication).
 */

export const PRICING_VERSION = '2026-06-11-invoice-policy';
// Bump this (and document the change) whenever any price, threshold, lease rule, or invoice policy changes.
// It is passed through to Stripe session metadata and surfaced in order emails.

export const HARDWARE_PRICES = {
  edge: 4990,
  studio: 7990,
  forge: 14900,
} as const;

export const SERVICE_PRICES = {
  managedCare: 99,
  secureVaultBackup: 49,
} as const;

export const LEASE_MAX = 200000;            // EUR - leasing not available above this hardware total
export const LEASE_MIN = 5000;              // EUR - leasing not available below this hardware total
export const LEASE_THRESHOLD = 10000;       // EUR — below this: 12mo lease; at/above: 24mo
export const LEASE_MONTHS_UNDER = 12;
export const LEASE_MONTHS_OVER = 24;

export const PBI_MAX = 20000;               // EUR - pay by invoice not available above this hardware total
export const PBI_MIN = 5000;                // EUR - pay by invoice not available below this hardware total

export const SEPA_MAX = 10000;              // EUR — Stripe-enforced soft cap for SEPA Direct Debit (we guard both sides)

export const INVOICE_ONLY_FULL_NO_SERVICES = false;
// When true, "Pay by Invoice (B2B)" would be restricted to financing='full' with no services.
// Currently false: full support for recurring services on invoice (send_invoice subs created for services;
// first periods included as lines on the initial net30 hardware invoice; future periods auto-sent by the subs).
// Lease + invoice remains disallowed in UI for now (to avoid changing stabilized lease flows).

export const UPFRONT_PERCENT = 20;          // % of hardware charged as upfront payment (leasing+pay by invoice)
// The upfrontAmount returned by calculateLease is both shown in the checkout popup
// (via leaseDetails) *and* collected as a separate one-time charge (in addition to
// the recurring subscription) when a lease order is created via Stripe.

export type HardwareSlug = keyof typeof HARDWARE_PRICES;
export type ServiceKey = keyof typeof SERVICE_PRICES;

export function getHardwarePrice(slug: string): number {
  const prices = HARDWARE_PRICES as Record<string, number>;
  return prices[slug] ?? 0;
}

export function getServicePrice(key: ServiceKey): number {
  return SERVICE_PRICES[key] ?? 0;
}

export interface LeaseDetails {
  months: number;
  monthlyTotal: number;
  hardwarePerMonth: number;
  upfrontAmount: number;     // amount due immediately when choosing lease
  financedAmount: number;    // remaining hardware amount financed over the term
  isAllowed: boolean;        // false when hardwareTotal > LEASE_MAX
}

/**
 * Server + client must use identical math.
 * 
 * When leasing:
 * - If hardwareTotal > LEASE_MAX → leasing not allowed (isAllowed=false)
 * - Upfront = round(hardwareTotal × UPFRONT_PERCENT / 100)
 * - Financed principal = hardwareTotal - upfront
 * - monthly = ceil(financed / months) + servicesMonthly
 * - Term (months) based on original hardwareTotal vs LEASE_THRESHOLD
 */
export function calculateLease(hardwareTotal: number, servicesMonthly: number = 0): LeaseDetails {
  const isAllowed = hardwareTotal >= LEASE_MIN && hardwareTotal <= LEASE_MAX;

  if (!isAllowed) {
    return {
      months: 0,
      monthlyTotal: 0,
      hardwarePerMonth: 0,
      upfrontAmount: 0,
      financedAmount: 0,
      isAllowed: false,
    };
  }

  const upfrontAmount = Math.round(hardwareTotal * (UPFRONT_PERCENT / 100));
  const financedAmount = hardwareTotal - upfrontAmount;

  const months = hardwareTotal < LEASE_THRESHOLD ? LEASE_MONTHS_UNDER : LEASE_MONTHS_OVER;
  const hardwarePerMonth = Math.ceil(financedAmount / months);

  return {
    months,
    monthlyTotal: hardwarePerMonth + servicesMonthly,
    hardwarePerMonth,
    upfrontAmount,
    financedAmount,
    isAllowed: true,
  };
}

export function isLeaseAllowed(hardwareTotal: number): boolean {
  return hardwareTotal >= LEASE_MIN && hardwareTotal <= LEASE_MAX;
}

export function getUpfrontAmount(hardwareTotal: number): number {
  if (!isLeaseAllowed(hardwareTotal)) return 0;
  return Math.round(hardwareTotal * (UPFRONT_PERCENT / 100));
}

export function isOverSepaLimit(amount: number): boolean {
  return amount > SEPA_MAX;
}

export function isPbiAllowed(hardwareTotal: number): boolean {
  return hardwareTotal >= PBI_MIN && hardwareTotal <= PBI_MAX;
}

export function isInvoiceAllowed(financing: 'full' | 'lease', servicesMonthly: number = 0): boolean {
  if (!INVOICE_ONLY_FULL_NO_SERVICES) return true;
  return financing === 'full' && servicesMonthly <= 0;
}

// Convenience re-export of service display names keys (used for translated names in UI/cart).
// The numeric prices always come from here; names stay in i18n for localization.
export const SERVICE_KEYS = Object.keys(SERVICE_PRICES) as ServiceKey[];
