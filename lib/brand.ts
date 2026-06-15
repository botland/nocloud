// Brand / white-label configuration.
// Values come from .env (NEXT_PUBLIC_ so they are available on both client and server).
// Defaults reproduce the original "nocloud.ai" behavior.
//
// BRAND_NAME can be stylized with capitals (e.g. "UncloudEngine") for display in logo, titles, "Why ...", cart items.
// The technical domain and email addresses are always lowercased.

export const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'nocloud';
export const BRAND_TLD = process.env.NEXT_PUBLIC_BRAND_TLD ?? '.ai';

// Lowercase slug for DNS / email / storage keys.
export const BRAND_SLUG = BRAND_NAME.toLowerCase();

// Full domain for technical use (emails, links, etc.). Always lowercase.
export const BRAND_DOMAIN =
  process.env.NEXT_PUBLIC_BRAND_DOMAIN ?? `${BRAND_SLUG}${BRAND_TLD.toLowerCase()}`;

// Display form that preserves the stylized casing of BRAND_NAME + TLD (e.g. "UncloudEngine.ai").
// Use this for UI copy, subjects, copyright, page titles, etc.
export const BRAND_DISPLAY = `${BRAND_NAME}${BRAND_TLD}`;

/**
 * Build an email address using the current (lowercased) brand domain.
 * Example: getBrandEmail('orders') => 'orders@uncloudengine.ai'
 */
export function getBrandEmail(localPart: 'orders' | 'no-reply' | 'sales'): string {
  return `${localPart}@${BRAND_DOMAIN}`;
}

// Convenience for storage keys (uses the lowercase slug).
export const STORAGE_PREFIX = BRAND_SLUG;