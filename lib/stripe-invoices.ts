import Stripe from 'stripe';

/**
 * Defensive cleanup for the €0 "trial period" draft/open invoices that Stripe
 * sometimes auto-generates when we create a subscription with trial_end (or
 * billing_cycle_anchor in some cases) for the "recurring starts exactly 1 month
 * after order" rule.
 *
 * This pattern appears in many places because every time we pre-create a
 * recurring sub (lease hardware, lease services, hybrid full services) we expand
 * latest_invoice and then have to clean the zero one.
 *
 * Extracted to kill the 15-25 line near-duplicate try blocks.
 */
export async function cleanupZeroTrialInvoice(
  stripe: Stripe,
  invId: string,
  context: string // e.g. "lease hardware sub sub_xxx (hybrid)"
) {
  try {
    const inv = await stripe.invoices.retrieve(invId);
    const isZero =
      (inv.total ?? 0) === 0 ||
      (inv.amount_due ?? 0) === 0 ||
      (inv.amount_paid ?? 0) === 0;

    // Only act on invoices that are clearly for this subscription's trial gap
    // (the check for subscription match is done by callers before calling in most cases,
    // but we keep a light guard here too).
    if (!isZero) return;

    if (inv.status === 'draft') {
      await stripe.invoices.del(invId);
      console.log(`Deleted draft €0 trial invoice ${invId} for ${context}`);
    } else if (inv.status === 'open') {
      await stripe.invoices.voidInvoice(invId);
      console.log(`Voided €0 trial invoice ${invId} for ${context}`);
    } else if (inv.status === 'paid' || inv.status === 'uncollectible') {
      console.log(
        `€0 trial invoice ${invId} for ${context} already finalized (status=${inv.status}); skipping.`
      );
    }
  } catch (err) {
    console.warn(`Could not clean up 0 trial invoice for ${context}`, err);
  }
}
