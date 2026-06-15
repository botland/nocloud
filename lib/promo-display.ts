/** Shared UTC date formatting for promotional copy (cards, checkout, badges). */
export function formatPromoDate(iso: string, locale: string): string {
  try {
    const d = new Date(`${iso}T00:00:00.000Z`);
    return d.toLocaleDateString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export function isRecurringPromo(
  amount: number,
  listAmount: number | undefined,
  untilDate: string | undefined,
): boolean {
  return !!untilDate && listAmount != null && listAmount > amount;
}

/** Omit /mo suffix when the current recurring rate is complimentary. */
export function recurringPriceSuffix(amount: number, suffix: string): string {
  return amount === 0 ? '' : suffix;
}