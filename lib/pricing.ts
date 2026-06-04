/**
 * lib/pricing.ts
 *
 * Single source of truth for *all* price-related data, thresholds, and calculations.
 *
 * - Hardware appliance one-time prices (EUR).
 * - Optional recurring service monthly prices (EUR).
 * - Lease term rules (12mo if hardware < threshold, else 24mo).
 * - SEPA payment method cap (Stripe limit we enforce client + server).
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

export const PRICING_VERSION = '2026-06-03';
// Bump this (and document the change) whenever any price, threshold, or lease rule changes.
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

export const LEASE_MAX = 20000;       // EUR - no leasing above this amount
export const LEASE_THRESHOLD = 10000; // EUR — below this: 12mo lease; at/above: 24mo
export const SEPA_MAX = 10000;        // EUR — Stripe-enforced soft cap for SEPA Direct Debit (we guard both sides)

export const LEASE_UPFRONT_PERCENT = 20;

export const LEASE_MONTHS_UNDER = 12;
export const LEASE_MONTHS_OVER = 24;

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
}

/**
 * Server + client must use identical math.
 * monthly = ceil(hardware / months) + servicesMonthly
 */
export function calculateLease(hardwareTotal: number, servicesMonthly: number = 0): LeaseDetails {
  const months = hardwareTotal < LEASE_THRESHOLD ? LEASE_MONTHS_UNDER : LEASE_MONTHS_OVER;
  const hardwarePerMonth = Math.ceil(hardwareTotal / months);
  return {
    months,
    monthlyTotal: hardwarePerMonth + servicesMonthly,
    hardwarePerMonth,
  };
}

export function isOverSepaLimit(amount: number): boolean {
  return amount > SEPA_MAX;
}

// Convenience re-export of service display names keys (used for translated names in UI/cart).
// The numeric prices always come from here; names stay in i18n for localization.
export const SERVICE_KEYS = Object.keys(SERVICE_PRICES) as ServiceKey[];
