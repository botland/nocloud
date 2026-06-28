// Brand / white-label configuration.
// Values come from .env (NEXT_PUBLIC_ so they are available on both client and server).
// Defaults updated to OwnEdge (European private AI infrastructure).
//
// BRAND_NAME can be stylized with capitals (e.g. "OwnEdge") for display in logo, titles, "Why ...", cart items.
// The technical domain and email addresses are always lowercased.

export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'OwnEdge';
export const BRAND_TLD = process.env.NEXT_PUBLIC_BRAND_TLD ?? '.ai';

// Lowercase slug for DNS / email / storage keys.
export const BRAND_SLUG = BRAND_NAME.toLowerCase();

// Full domain for technical use (emails, links, etc.). Always lowercase.
export const BRAND_DOMAIN =
  process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? `${BRAND_SLUG}${BRAND_TLD.toLowerCase()}`;

// Display form that preserves the stylized casing of BRAND_NAME + TLD (e.g. "OwnEdge.ai").
// Use this for UI copy, subjects, copyright, page titles, etc.
export const BRAND_DISPLAY = `${BRAND_NAME}${BRAND_TLD}`;

/**
 * Build an email address using the current (lowercased) brand domain.
 * Example: getBrandEmail('support') => 'support@ownedge.ai'
 */
export function getBrandEmail(localPart: 'orders' | 'no-reply' | 'sales' | 'support'): string {
  return `${localPart}@${BRAND_DOMAIN}`;
}

// Convenience for storage keys (uses the lowercase slug).
export const STORAGE_PREFIX = BRAND_SLUG;

// ============================================================
// Invariant legal / company details (used in /legal and /privacy pages)
// These values are NOT translated. Declared centrally here for easy
// white-labeling / re-branding (e.g. future nocloud.ai or notier.com).
// en.json references them via {placeholders} so translations stay clean.
export const COMPANY_LEGAL_NAME = 'OwnEdge OÜ';
export const REGISTRY_NUMBER = '12345678';
export const VAT_NUMBER = 'EE123456789';
export const COMPANY_ADDRESS = 'Tallinn, Harju County, Estonia';
export const MANAGING_DIRECTOR = 'Alexandre Bureau';
export const LEGAL_CONTACT_EMAIL = 'hello@ownedge.eu';
