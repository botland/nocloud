import Stripe from 'stripe';
import { mapStripeErrorToMessage } from './stripe-errors';
import { createPaymentMethodUpdateUrl } from './stripe-billing-portal';
import {
  sendRecurringPaymentWarningEmail,
  sendRecurringPaymentCancelledEmail,
  sendAdminRecurringPaymentCancelledEmail,
} from './emails';

export interface RecurringDunningConfig {
  warnDays: number;
  cancelDays: number;
}

const DAY_SECONDS = 24 * 3600;

export function getRecurringDunningConfig(): RecurringDunningConfig {
  const warnDays = parseInt(process.env.RECURRING_PM_FAILURE_WARN_DAYS || '7', 10);
  const cancelDays = parseInt(process.env.RECURRING_PM_FAILURE_CANCEL_DAYS || '14', 10);
  return {
    warnDays: Number.isFinite(warnDays) && warnDays > 0 ? warnDays : 7,
    cancelDays: Number.isFinite(cancelDays) && cancelDays > 0 ? cancelDays : 14,
  };
}

/**
 * Service subscriptions created by nocloud carry line_type=recurring_service.
 * Applies equally in preorder and live commerce mode — ongoing billing is independent
 * of how the original hardware order was placed.
 */
export function isServiceSubscription(sub: Stripe.Subscription): boolean {
  const meta = sub.metadata || {};
  return meta.line_type === 'recurring_service' || !!meta.host_serial_number;
}

export function dunningElapsedDays(firstFailedAtUnix: number, nowUnix = Math.floor(Date.now() / 1000)): number {
  return Math.floor((nowUnix - firstFailedAtUnix) / DAY_SECONDS);
}

export interface DunningEmailContext {
  customerEmail: string;
  serviceName: string;
  hostSerialNumber?: string;
  failureReason: string;
  portalUrl: string;
  locale?: string;
  subscriptionId: string;
  cancelDays?: number;
}

export async function processSubscriptionDunning(
  stripe: Stripe,
  sub: Stripe.Subscription,
  options?: { nowUnix?: number; skipCancel?: boolean },
): Promise<'none' | 'warned' | 'cancelled'> {
  const meta = sub.metadata || {};
  const firstFailedRaw = meta.first_payment_failed_at;
  if (!firstFailedRaw) return 'none';

  const firstFailedAt = parseInt(firstFailedRaw, 10);
  if (!Number.isFinite(firstFailedAt) || firstFailedAt <= 0) return 'none';

  const { warnDays, cancelDays } = getRecurringDunningConfig();
  const nowUnix = options?.nowUnix ?? Math.floor(Date.now() / 1000);
  const elapsed = dunningElapsedDays(firstFailedAt, nowUnix);
  const stage = meta.dunning_stage || 'failed';

  if (stage === 'cancelled') return 'cancelled';

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return 'none';

  let customerEmail = meta.customer_email || '';
  if (!customerEmail) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer.deleted) {
        customerEmail = (customer as Stripe.Customer).email || '';
      }
    } catch {
      // proceed without email
    }
  }

  const serviceName = meta.service || 'Service';
  const hostSerialNumber = meta.host_serial_number || meta.serial_number;
  const locale = (meta.locale as string) || 'en';
  const portalUrl = await createPaymentMethodUpdateUrl(stripe, customerId);
  const failureReason = meta.last_payment_failure_reason || mapStripeErrorToMessage({ code: 'payment_failed' }, locale);

  const emailCtx: DunningEmailContext = {
    customerEmail,
    serviceName,
    hostSerialNumber,
    failureReason,
    portalUrl,
    locale,
    subscriptionId: sub.id,
    cancelDays,
  };

  if (!options?.skipCancel && elapsed >= cancelDays && stage !== 'cancelled') {
    await stripe.subscriptions.update(sub.id, {
      metadata: { ...meta, dunning_stage: 'cancelled' },
    });
    await stripe.subscriptions.cancel(sub.id);

    if (customerEmail) {
      await sendRecurringPaymentCancelledEmail(emailCtx);
    }
    await sendAdminRecurringPaymentCancelledEmail(emailCtx);
    return 'cancelled';
  }

  if (elapsed >= warnDays && stage === 'failed') {
    if (customerEmail) {
      await sendRecurringPaymentWarningEmail(emailCtx);
    }
    await stripe.subscriptions.update(sub.id, {
      metadata: { dunning_stage: 'warned' },
    });
    return 'warned';
  }

  return 'none';
}

export async function processAllRecurringDunning(stripe: Stripe): Promise<{
  checked: number;
  warned: number;
  cancelled: number;
}> {
  let checked = 0;
  let warned = 0;
  let cancelled = 0;

  let startingAfter: string | undefined;
  do {
    const page = await stripe.subscriptions.list({
      status: 'active',
      limit: 100,
      starting_after: startingAfter,
    });

    for (const sub of page.data) {
      if (!isServiceSubscription(sub)) continue;
      if (sub.collection_method !== 'charge_automatically') continue;
      if (!sub.metadata?.first_payment_failed_at) continue;

      checked += 1;
      const result = await processSubscriptionDunning(stripe, sub);
      if (result === 'warned') warned += 1;
      if (result === 'cancelled') cancelled += 1;
    }

    startingAfter = page.has_more ? page.data[page.data.length - 1]?.id : undefined;
  } while (startingAfter);

  return { checked, warned, cancelled };
}