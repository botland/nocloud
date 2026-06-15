import {
  isLeaseAllowed,
  isPbiAllowed,
  isInvoiceAllowed,
  isOverSepaLimit,
  getHardwarePrice,

  ServiceKey,
  PRICING_VERSION,
  calculateHardwarePrice,
  formatHardwareCustomization,
  type HardwareCustomization,
} from './pricing';
import { resolveHardwarePrice, resolveServicePrice } from './promotions';

export type Financing = 'full' | 'lease';
export type PaymentMethod = 'stripe' | 'sepa' | 'invoice';
export type RecurringPaymentMethod = 'stripe' | 'sepa' | undefined;

export interface PaymentContext {
  financing: Financing;
  paymentMethod: PaymentMethod;
  hasServices: boolean;
  recurringPaymentMethod?: RecurringPaymentMethod;
  /** High-level strategy name for logging and branching */
  strategy:
    | 'lease-card-sepa'
    | 'lease-invoice'
    | 'lease-invoice-hybrid'
    | 'full-card-sepa'
    | 'full-invoice'
    | 'full-invoice-hybrid'
    | 'invalid';
  isHybridRecurringSetup: boolean;
  requiresCustomer: boolean;
}

/**
 * Pure function that turns the raw checkout inputs into a single PaymentContext.
 * This is the beginning of moving the 2x2x2 decision matrix out of the giant route handler.
 * Callers can switch on context.strategy for clearer control flow.
 */
export function buildPaymentContext(params: {
  financing: Financing;
  paymentMethod: PaymentMethod;
  servicesMonthly: number;
  hardwareTotal: number;
  recurringPaymentMethod?: RecurringPaymentMethod;
  /** Any recurring service in the order (including launch-free / €0 promos). */
  hasRecurringServices?: boolean;
}): PaymentContext {
  const { financing, paymentMethod, servicesMonthly, hardwareTotal, recurringPaymentMethod, hasRecurringServices } = params;
  const hasServices = hasRecurringServices ?? servicesMonthly > 0;

  const isHybrid = paymentMethod === 'invoice' && hasServices && (recurringPaymentMethod === 'stripe' || recurringPaymentMethod === 'sepa');

  let strategy: PaymentContext['strategy'] = 'invalid';

  if (financing === 'lease') {
    if (paymentMethod === 'invoice') {
      strategy = isHybrid ? 'lease-invoice-hybrid' : 'lease-invoice';
    } else {
      strategy = 'lease-card-sepa';
    }
  } else {
    if (paymentMethod === 'invoice') {
      strategy = isHybrid ? 'full-invoice-hybrid' : 'full-invoice';
    } else {
      strategy = 'full-card-sepa';
    }
  }

  const isHybridRecurringSetup = isHybrid;

  // All paths that create a durable customer record up front (we do for every real path now)
  const requiresCustomer = true;

  return {
    financing,
    paymentMethod,
    hasServices,
    recurringPaymentMethod,
    strategy,
    isHybridRecurringSetup,
    requiresCustomer,
  };
}

/**
 * Run the server-side eligibility checks (mirrors what the client also enforces).
 * Returns error message or null if OK.
 */
export function validatePaymentEligibility(context: PaymentContext, hardwareTotal: number, dueAmount: number, servicesMonthly: number): string | null {
  if (context.financing === 'lease' && !isLeaseAllowed(hardwareTotal)) {
    // The caller has the exact MIN/MAX constants
    return 'LEASE_RANGE';
  }
  if (context.paymentMethod === 'invoice' && !isPbiAllowed(hardwareTotal)) {
    return 'PBI_RANGE';
  }
  if (context.paymentMethod === 'invoice' && !isInvoiceAllowed(context.financing, servicesMonthly)) {
    return 'INVOICE_POLICY';
  }
  if (context.paymentMethod === 'sepa' && isOverSepaLimit(dueAmount)) {
    return 'SEPA_MAIN';
  }
  if (context.paymentMethod === 'invoice' && context.recurringPaymentMethod === 'sepa' && isOverSepaLimit(servicesMonthly)) {
    return 'SEPA_SERVICES';
  }
  return null;
}

/**
 * Pure resolver for authoritative prices (server never trusts client prices).
 * Returns hardware total, services monthly, and the resolved services array
 * (with display names) that goes into metadata.
 */
export interface ResolvedOrderAmounts {
  hardwareTotal: number;
  servicesMonthly: number;
  resolvedServicesForMeta: Array<{ name: string; price: number }>;
  // Hardware customizations (when present in items). Includes chosen labels (e.g. "2 TB HDD")
  // and the extra cost so that metadata, line item descriptions, and emails can surface them.
  resolvedHardwareForMeta: Array<{ name: string; config: string; extraCost: number }>;
}

export function resolvePricesAndServices(items: any[] = []): ResolvedOrderAmounts {
  let hardwareTotal = 0;
  let servicesMonthly = 0;
  const resolvedServicesForMeta: Array<{ name: string; price: number }> = [];
  const resolvedHardwareForMeta: Array<{ name: string; config: string; extraCost: number }> = [];

  for (const item of items) {
    const qty = item.quantity || 1;
    const slug = item.product?.slug as string | undefined;

    // Use the single logical component (calculateHardwarePrice) when customization is supplied.
    // Falls back to base price for items without customization (preserves all existing behavior).
    const customization = item.customization as HardwareCustomization | undefined;
    const hwResolved = slug
      ? resolveHardwarePrice(slug, customization)
      : undefined;
    const unitHw = hwResolved?.net ?? (item.product?.price || 0);

    const baseForSlug = slug ? getHardwarePrice(slug) : 0;
    const listUnitBeforePromo = slug
      ? (customization ? calculateHardwarePrice(slug, customization) : getHardwarePrice(slug))
      : unitHw;
    const extraForItem = Math.max(0, listUnitBeforePromo - baseForSlug);

    hardwareTotal += unitHw * qty;

    // Record chosen config (with tech labels) + the extra that was charged for this line.
    const configStr = formatHardwareCustomization(item.customization as HardwareCustomization | undefined) ||
      (slug ? 'Standard' : '');
    if (slug) {
      resolvedHardwareForMeta.push({
        name: item.product?.name || slug,
        config: configStr,
        extraCost: extraForItem * qty,
      });
    }

    const svcs = item.services || [];
    for (const s of svcs) {
      const key = (s.key as ServiceKey | undefined) || undefined;
      const svcPrice = key ? resolveServicePrice(key, slug).net : (s.price || 0);
      const lineTotal = svcPrice * qty;
      servicesMonthly += lineTotal;

      const displayName = s.name || (key ? key : 'Service');
      resolvedServicesForMeta.push({ name: displayName, price: lineTotal });
    }
  }

  return { hardwareTotal, servicesMonthly, resolvedServicesForMeta, resolvedHardwareForMeta };
}

