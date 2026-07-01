/**
 * Map Stripe error codes to customer-facing messages (EN/FR).
 * Used in balance fulfillment fallback and recurring dunning emails.
 */

export interface StripeErrorLike {
  code?: string;
  decline_code?: string;
  message?: string;
  type?: string;
}

export function extractStripeErrorCode(err: unknown): string {
  const e = err as StripeErrorLike;
  return e?.decline_code || e?.code || e?.type || 'payment_failed';
}

export function mapStripeErrorToMessage(err: unknown, locale = 'en'): string {
  const e = err as StripeErrorLike;
  const code = extractStripeErrorCode(err);
  const isFr = locale === 'fr';

  const messages: Record<string, { en: string; fr: string }> = {
    card_declined: {
      en: 'Your card was declined. Please update your payment method or use the invoice link to pay.',
      fr: 'Votre carte a été refusée. Veuillez mettre à jour votre moyen de paiement ou utiliser le lien de facture.',
    },
    insufficient_funds: {
      en: 'Insufficient funds on the payment method. Please update your card or pay via the invoice link.',
      fr: 'Fonds insuffisants sur le moyen de paiement. Veuillez mettre à jour votre carte ou payer via le lien de facture.',
    },
    authentication_required: {
      en: 'Your bank requires additional authentication. Please update your payment method or pay via the invoice link.',
      fr: 'Votre banque exige une authentification supplémentaire. Veuillez mettre à jour votre moyen de paiement ou payer via le lien de facture.',
    },
    expired_card: {
      en: 'Your card has expired. Please update your payment method or pay via the invoice link.',
      fr: 'Votre carte a expiré. Veuillez mettre à jour votre moyen de paiement ou payer via le lien de facture.',
    },
    processing_error: {
      en: 'A temporary processing error occurred. Please try again or pay via the invoice link.',
      fr: 'Une erreur de traitement temporaire s\'est produite. Veuillez réessayer ou payer via le lien de facture.',
    },
    charge_failed: {
      en: 'The automatic charge could not be completed. Please pay via the invoice link provided.',
      fr: 'Le prélèvement automatique n\'a pas pu être effectué. Veuillez payer via le lien de facture fourni.',
    },
    payment_failed: {
      en: 'The payment could not be processed. Please update your payment method or use the provided pay link.',
      fr: 'Le paiement n\'a pas pu être traité. Veuillez mettre à jour votre moyen de paiement ou utiliser le lien de paiement fourni.',
    },
  };

  const hasExplicitCode = !!(e?.decline_code || e?.code || e?.type);
  const mapped = messages[code];
  if (mapped && (hasExplicitCode || code !== 'payment_failed')) {
    return isFr ? mapped.fr : mapped.en;
  }

  const fallback = e?.message;
  if (fallback) return fallback;
  return isFr
    ? 'Le paiement automatique a échoué. Veuillez utiliser le lien de paiement fourni.'
    : 'Automatic payment failed. Please use the payment link provided.';
}