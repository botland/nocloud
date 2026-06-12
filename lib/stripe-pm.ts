import Stripe from 'stripe';
import { DEBUG_PAYMENTS } from './pricing';

/**
 * Robustly extracts a usable default payment method (card or sepa_debit) from a
 * completed Checkout Session.
 *
 * Handles:
 * - Classic payment-mode sessions (payment_intent)
 * - Hybrid setup-mode sessions (setup_intent) used for "invoice hardware + card/sepa recurring"
 * - Session may be partially expanded or not; we re-retrieve with both expands when needed
 * - Fallback to listing recent customer PMs
 *
 * Returns the PM id (string) or undefined.
 *
 * Used by createFullServiceSubscriptions, webhook lease attach blocks, etc.
 */
export async function extractPaymentMethodFromSession(
  stripe: Stripe,
  completedSession: Stripe.Checkout.Session
): Promise<string | undefined> {
  let defaultPaymentMethod: string | undefined;

  // Try direct (if the event/session came pre-expanded)
  const sessionPm = (completedSession as any).payment_method as string | undefined;
  if (sessionPm) {
    return sessionPm;
  }

  // Decide whether we need a fresh retrieve with expands
  const needsReRetrieve =
    !completedSession.payment_intent || typeof completedSession.payment_intent === 'string' ||
    !completedSession.setup_intent || typeof completedSession.setup_intent === 'string';

  let sessionForPm: any = completedSession;
  if (needsReRetrieve) {
    try {
      sessionForPm = await stripe.checkout.sessions.retrieve(completedSession.id, {
        expand: ['payment_intent.payment_method', 'setup_intent.payment_method'],
      });
    } catch (e) {
      console.warn('Could not re-retrieve/expand checkout session for PM', e);
    }
  }

  const s = sessionForPm;

  // Rare direct payment_method on the session object after expand
  const directPm = (s as any).payment_method as string | undefined;
  if (directPm) {
    defaultPaymentMethod = directPm;
  }

  if (!defaultPaymentMethod) {
    // payment_intent (classic full) or setup_intent (hybrid recurring under invoice)
    let intent: any = s.payment_intent || s.setup_intent;
    const intentId = typeof intent === 'string' ? intent : (intent && intent.id);
    if (intentId) {
      try {
        const isSetup = !!s.setup_intent ||
          (intent && (intent.object === 'setup_intent' || (typeof intent === 'object' && !intent.client_secret)));
        if (isSetup) {
          const retrievedSi = await stripe.setupIntents.retrieve(intentId, { expand: ['payment_method'] });
          const pm = (retrievedSi as any).payment_method;
          const candidate = typeof pm === 'string' ? pm : pm?.id;
          if (candidate) defaultPaymentMethod = candidate;
        } else {
          const retrievedPi = await stripe.paymentIntents.retrieve(intentId, { expand: ['payment_method'] });
          const pm = (retrievedPi as any).payment_method;
          const candidate = typeof pm === 'string' ? pm : pm?.id;
          if (candidate) defaultPaymentMethod = candidate;
        }
      } catch (retrieveErr) {
        console.warn('Could not expand payment_intent/setup_intent to obtain payment_method', retrieveErr);
      }
    }
  }

  // Last resort: list recent PMs on the customer
  if (!defaultPaymentMethod && s.customer) {
    try {
      const pms = await stripe.customers.listPaymentMethods(s.customer as string, { limit: 5 });
      const recent = pms.data.find((p: any) => p.type === 'card' || p.type === 'sepa_debit');
      if (recent?.id) defaultPaymentMethod = recent.id;
    } catch (listErr) {
      console.warn('Could not list recent PMs for default', listErr);
    }
  }

  if (DEBUG_PAYMENTS && defaultPaymentMethod) {
    console.log('[PAYMENT DEBUG] extractPM: resolved defaultPaymentMethod=', defaultPaymentMethod);
  }
  return defaultPaymentMethod;
}

/**
 * Sets the given PM as the customer's invoice_settings.default_payment_method.
 * Optionally also applies it to one or more subscriptions.
 * Errors are logged as warnings (non-fatal for the calling flow).
 */
export async function setDefaultPaymentMethodOnCustomerAndSubs(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string,
  subscriptionIds: string[] = []
) {
  if (!paymentMethodId || !customerId) return;

  try {
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  } catch (custErr) {
    console.warn('Could not set default pm on customer', custErr);
  }

  for (const subId of subscriptionIds) {
    if (!subId) continue;
    try {
      await stripe.subscriptions.update(subId, {
        default_payment_method: paymentMethodId,
      });
    } catch (attachErr) {
      console.warn('Failed to attach PM to subscription', subId, attachErr);
    }
  }
}
