/**
 * lib/pricing.ts
 *
 * Single source of truth for *all* price-related data, thresholds, and calculations.
 *
 * - Hardware appliance one-time prices (EUR).
 * - Optional recurring service monthly prices (EUR).
 * - Tiered hardware customization: TIER_SPEC_OPTIONS + pure helpers for RAM/VRAM/Disk pre-select options
 *   (each option has numeric value + tech-aware label + additive per-appliance price). Single source
 *   used by Configurator (live), cart, server resolve, line items, and order metadata/emails.
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

export const PRICING_VERSION = '2026-06-15-promotions-launch';
// Bump this (and document the change) whenever any price, threshold, lease rule, or invoice policy changes.
// It is passed through to Stripe session metadata and surfaced in order emails.

export const DEBUG_PAYMENTS = process.env.DEBUG_PAYMENTS === 'true' || process.env.DEBUG_PAYMENTS === '1';
// Set DEBUG_PAYMENTS=true (or 1) in env to enable verbose console logs for tracing
// checkout routing, metadata, webhook branches, PM extraction, and subscription creation/fallbacks.
// Useful to diagnose why full credit card + services produces no recurring subs.

export const HARDWARE_PRICES = {
  edge: 4990,
  studio: 7990,
  forge: 14900,
} as const;

export type HardwareSlug = keyof typeof HARDWARE_PRICES;

/** Studio-tier monthly prices (legacy flat reference + marketing fallback). */
export const SERVICE_PRICES = {
  managedCare: 99,
  secureVaultBackup: 49,
} as const;

export type ServiceKey = keyof typeof SERVICE_PRICES;

/** Authoritative recurring service prices per hardware tier (EUR / month / appliance). */
export const SERVICE_PRICES_BY_TIER: Record<HardwareSlug, Record<ServiceKey, number>> = {
  edge: { managedCare: 58, secureVaultBackup: 29 },
  studio: { managedCare: 99, secureVaultBackup: 49 },
  forge: { managedCare: 149, secureVaultBackup: 79 },
};

export const LEASE_MAX = 20000;             // EUR - leasing not available above this hardware total
export const LEASE_MIN = 5000;              // EUR - leasing not available below this hardware total
export const LEASE_THRESHOLD = 10000;       // EUR — below this: 12mo lease; at/above: 24mo
export const LEASE_MONTHS_UNDER = 12;
export const LEASE_MONTHS_OVER = 24;

export const PBI_MAX = 200000;              // EUR - pay by invoice not available above this hardware total
export const PBI_MIN = 5000;                // EUR - pay by invoice not available below this hardware total

export const SEPA_MAX = 10000;              // EUR — Stripe-enforced soft cap for SEPA Direct Debit (we guard both sides)

export const INVOICE_ONLY_FULL_NO_SERVICES = false;
// "Pay by Invoice (B2B)" is allowed for full (hardware/upfront) even when services are present.
// Recurring services are never paid via invoice: the UI forces a separate card/SEPA choice inside
// the invoice box for the recurring part (which triggers a mode:'setup' Checkout to collect the PM
// and later creates automatic charge_automatically service subs). The old send_invoice service subs
// path is kept only as a fallback when the new field is not supplied (keeps existing tests working).
// Lease + invoice remains disallowed in UI (safety rule).

/** Fixed B2B pre-order deposit per hardware tier (EUR). Credited toward final price at ship time. */
export const PREORDER_DEPOSITS: Record<HardwareSlug, number> = {
  edge: 500,
  studio: 1500,
  forge: 5000,
};

export const PREORDER_PRICE_LOCK_POLICY = 'honor_quoted' as const;

export const UPFRONT_PERCENT = 20;          // % of hardware charged as upfront payment (leasing+pay by invoice)
// The upfrontAmount returned by calculateLease is both shown in the checkout popup
// (via leaseDetails) *and* collected as a separate one-time charge (in addition to
// the recurring subscription) when a lease order is created via Stripe.

export function getHardwarePrice(slug: string): number {
  const prices = HARDWARE_PRICES as Record<string, number>;
  return prices[slug] ?? 0;
}

export function getPreorderDeposit(slug: string): number {
  if (slug in PREORDER_DEPOSITS) {
    return PREORDER_DEPOSITS[slug as HardwareSlug];
  }
  return 0;
}

/** Sum deposit across cart line items (server-authoritative). */
export function computeTotalPreorderDeposit(
  items: Array<{ product?: { slug?: string }; quantity?: number }>,
): number {
  return (items || []).reduce((sum, item) => {
    const slug = item.product?.slug;
    const qty = item.quantity || 1;
    if (!slug) return sum;
    return sum + getPreorderDeposit(slug) * qty;
  }, 0);
}

export interface PreorderQuote {
  hardwareTotal: number;
  totalDeposit: number;
  balanceDue: number;
}

export function computePreorderQuote(hardwareTotal: number, totalDeposit: number): PreorderQuote {
  const deposit = Math.min(totalDeposit, hardwareTotal);
  return {
    hardwareTotal,
    totalDeposit: deposit,
    balanceDue: Math.max(0, hardwareTotal - deposit),
  };
}

export function getServicePrice(key: ServiceKey, hardwareSlug?: HardwareSlug | string): number {
  if (hardwareSlug && hardwareSlug in SERVICE_PRICES_BY_TIER) {
    return SERVICE_PRICES_BY_TIER[hardwareSlug as HardwareSlug][key] ?? 0;
  }
  return SERVICE_PRICES[key] ?? 0;
}

/** Lowest base catalog tier price (before promotions). Prefer resolveMinServicePrice for UI. */
export function getMinServicePrice(key: ServiceKey): number {
  return Math.min(
    ...Object.values(SERVICE_PRICES_BY_TIER).map((tier) => tier[key] ?? Infinity),
  );
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

/**
 * Hardware customization (RAM / VRAM / Disk) — per-tier pre-select options.
 *
 * This + the four pure helpers below are the SINGLE LOGICAL COMPONENT for spec configuration
 * and pricing. Every consumer (ConfiguratorModal for interactive selects + live preview,
 * page.tsx for cart qty updates, payment-flow.ts resolve, checkout route for authoritative
 * line items, webhook/emails for order descriptions) must derive from here.
 *
 * Design notes:
 * - Each SpecOption carries a numeric `value` (for pricing math), a human `label` (shown to
 *   the customer and persisted for order accuracy — enables different technologies such as
 *   "1 TB NVMe" vs "2 TB HDD" even if numeric TB overlaps), and the additive `price` (EUR).
 * - The tier's default for a key is conventionally the option with price === 0.
 * - calculateHardwarePrice(slug, customization) = base hardware + sum(option prices for chosen values).
 *   If a dimension is absent from customization we fall back to the tier default (price 0).
 * - All functions are pure and must stay identical on client and server.
 */

export interface SpecOption {
  value: number;
  label: string;
  price: number; // additive per-appliance cost for selecting exactly this option
}

export interface TierSpecOptions {
  ram: SpecOption[];
  vram: SpecOption[];
  disk: SpecOption[];
}

export interface ChosenSpec {
  value: number;
  label: string;
}

export interface HardwareCustomization {
  ram?: ChosenSpec;
  vram?: ChosenSpec;
  disk?: ChosenSpec;
}

// Concrete per-tier curated options. The price-0 entry in each list is the documented default.
// Technology labels (e.g. NVMe vs HDD) are carried so future evolution is free (no numeric-only assumption).
export const TIER_SPEC_OPTIONS: Record<HardwareSlug, TierSpecOptions> = {
  edge: {
    ram: [
      { value: 32, label: '32 GB', price: 0 },	// default
      { value: 64, label: '64 GB', price: 490 },
    ],
    vram: [
      { value: 16, label: '16 GB GDDR6', price: 0 },     // default
      { value: 20, label: '20 GB GDDR6', price: 1590 },
      { value: 24, label: '24 GB GDDR6', price: 2690 },
      { value: 32, label: '32 GB GDDR7', price: 4090 },
    ],
    disk: [
      { value: 1, label: '2 TB NVMe', price: 0 },  // default
      { value: 4, label: '4 TB NVMe', price: 790 },
    ],
  },
  studio: {
    ram: [
      { value: 64, label: '64 GB', price: 0 },	// default
      { value: 128, label: '128 GB', price: 1090 },
    ],
    vram: [
      { value: 32, label: '32 GB GDDR6', price: 0 },     // default
      { value: 48, label: '48 GB GDDR7', price: 6290 },
      { value: 72, label: '72 GB GDDR7', price: 8890 },
    ],
    disk: [
      { value: 4, label: '4 TB NVMe', price: 0 },	// default
      { value: 8, label: '8 TB NVMe', price: 1590 },
    ],
  },
  forge: {
    ram: [
      { value: 128, label: '128 GB', price: 0 },   // default
      { value: 192, label: '192 GB', price: 2290 },
      { value: 256, label: '256 GB', price: 7690 },
    ],
    vram: [
      { value: 64, label: '64 GB GDDR6', price: 0 }, // default
      { value: 72, label: '72 GB GDDR7 ECC', price: 10490 },
      { value: 96, label: '96 GB GDDR7 ECC', price: 12090 },
      { value: 144, label: '144 GB GDDR7 ECC', price: 20490 },
      { value: 192, label: '192 GB GDDR7 ECC', price: 24090 },
    ],
    disk: [
      { value: 8, label: '8 TB NVMe RAID 1', price: 0 }, // default
      { value: 16, label: '16 TB NVMe RAID 1', price: 3290 },
      { value: 32, label: '32 TB NVMe RAID 1', price: 7490 },
    ],
  },
} as const;

export function getSpecOptions(slug: string, key: 'ram' | 'vram' | 'disk'): SpecOption[] {
  const tier = TIER_SPEC_OPTIONS[slug as HardwareSlug];
  if (!tier) return [];
  return tier[key] ?? [];
}

export function getDefaultOption(slug: string, key: 'ram' | 'vram' | 'disk'): SpecOption | null {
  const opts = getSpecOptions(slug, key);
  // Convention: the option with price 0 is the tier default. Fall back to first.
  return opts.find((o) => o.price === 0) ?? opts[0] ?? null;
}

export function getOptionPrice(slug: string, key: 'ram' | 'vram' | 'disk', value: number): number {
  const opts = getSpecOptions(slug, key);
  const match = opts.find((o) => o.value === value);
  return match ? match.price : 0;
}

/**
 * Authoritative hardware price for a tier + chosen customization.
 * Base price (from HARDWARE_PRICES) + additive prices of the selected options.
 * Missing dimensions in customization fall back to the tier's default option (price 0).
 * Used by client (live preview, cart qty) and server (resolvePricesAndServices) — must stay identical.
 */
export function calculateHardwarePrice(slug: string, customization?: HardwareCustomization): number {
  const base = getHardwarePrice(slug);
  if (!customization) return base;

  let extra = 0;
  (['ram', 'vram', 'disk'] as const).forEach((k) => {
    const chosen = customization[k];
    if (chosen && typeof chosen.value === 'number') {
      extra += getOptionPrice(slug, k, chosen.value);
    } else {
      // fall back to default (normally 0)
      const def = getDefaultOption(slug, k);
      if (def) extra += def.price;
    }
  });

  return base + extra;
}

// Helper to produce a compact human string from a customization (for cart summaries,
// invoice descriptions, emails, metadata). Falls back gracefully.
export function formatHardwareCustomization(customization?: HardwareCustomization): string {
  if (!customization) return '';
  const parts: string[] = [];
  if (customization.ram) parts.push(`RAM ${customization.ram.label}`);
  if (customization.vram) parts.push(`VRAM ${customization.vram.label}`);
  if (customization.disk) parts.push(`Disk ${customization.disk.label}`);
  return parts.join(' • ');
}
