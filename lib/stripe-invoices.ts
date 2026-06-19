import Stripe from 'stripe';

export interface CheckoutInvoiceCreationInput {
  metadata: Record<string, string>;
  company?: string;
  vatNumber?: string;
  poNumber?: string;
  vatTreatment?: string;
  description?: string;
}

/**
 * Enables Stripe post-payment Invoice generation for Checkout Sessions in `payment` mode
 * (card / SEPA). Requires a Stripe Customer on the session.
 */
export function buildCheckoutInvoiceCreation(
  input: CheckoutInvoiceCreationInput,
): Stripe.Checkout.SessionCreateParams.InvoiceCreation {
  const custom_fields: Array<{ name: string; value: string }> = [];
  if (input.company?.trim()) {
    custom_fields.push({ name: 'Company', value: input.company.trim() });
  }
  if (input.vatNumber?.trim() && input.vatNumber !== 'N/A') {
    custom_fields.push({ name: 'VAT Number', value: input.vatNumber.trim() });
  }
  if (input.poNumber?.trim() && input.poNumber !== 'N/A') {
    custom_fields.push({ name: 'PO Number', value: input.poNumber.trim() });
  }

  let footer: string | undefined;
  if (input.vatTreatment === 'reverse_charge') {
    footer =
      'Reverse charge — VAT to be accounted for by the customer (Article 196 EU VAT Directive).';
  }

  return {
    enabled: true,
    invoice_data: {
      metadata: input.metadata,
      description: input.description,
      footer,
      custom_fields: custom_fields.length ? custom_fields : undefined,
    },
  };
}

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
async function voidZeroDraftTrialInvoice(
  stripe: Stripe,
  invId: string,
  context: string
) {
  // Subscription drafts cannot be deleted (Stripe rejects del even when
  // inv.subscription is absent on retrieve). Finalize then void, or accept €0 paid.
  const finalized = await stripe.invoices.finalizeInvoice(invId);
  if (finalized.status === 'open') {
    await stripe.invoices.voidInvoice(invId);
    console.log(`Voided €0 trial invoice ${invId} for ${context}`);
  } else {
    console.log(
      `€0 trial invoice ${invId} for ${context} finalized (status=${finalized.status}); skipping.`
    );
  }
}

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
      await voidZeroDraftTrialInvoice(stripe, invId, context);
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

/**
 * After creating a subscription with trial_end, Stripe may create a draft invoice.
 * €0 trial invoices are deleted; non-zero drafts get auto_advance so they finalize
 * and can be collected (required for send_invoice subscriptions to work).
 */
export async function handleSubscriptionTrialInvoice(
  stripe: Stripe,
  invId: string,
  context: string,
  extra?: { description?: string; footer?: string }
) {
  try {
    const inv = await stripe.invoices.retrieve(invId);
    const isZero =
      (inv.total ?? 0) === 0 ||
      (inv.amount_due ?? 0) === 0;

    if (isZero) {
      await cleanupZeroTrialInvoice(stripe, invId, context);
      return;
    }

    if (inv.status === 'draft' || inv.status === 'open') {
      await stripe.invoices.update(invId, {
        auto_advance: true,
        ...(extra?.description ? { description: extra.description } : {}),
        ...(extra?.footer ? { footer: extra.footer } : {}),
      });
      console.log(`Set auto_advance on subscription trial invoice ${invId} for ${context}`);
    }
  } catch (err) {
    console.warn(`Could not handle subscription trial invoice for ${context}`, err);
  }
}
