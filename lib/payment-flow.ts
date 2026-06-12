import { isLeaseAllowed, isPbiAllowed, isInvoiceAllowed, isOverSepaLimit } from './pricing';

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
}): PaymentContext {
  const { financing, paymentMethod, servicesMonthly, hardwareTotal, recurringPaymentMethod } = params;
  const hasServices = servicesMonthly > 0;

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
