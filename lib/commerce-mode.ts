export type CommerceMode = 'preorder' | 'live';

/**
 * Site commerce mode — flips the entire storefront between pre-order deposits
 * and full Configure & Buy without code changes.
 *
 * Set NEXT_PUBLIC_COMMERCE_MODE=live on launch day.
 * Defaults to preorder when unset (safe for pre-launch).
 */
export function getCommerceMode(): CommerceMode {
  const raw = process.env.NEXT_PUBLIC_COMMERCE_MODE?.trim().toLowerCase();
  return raw === 'live' ? 'live' : 'preorder';
}

export function isPreorderMode(): boolean {
  return getCommerceMode() === 'preorder';
}

export function isLiveMode(): boolean {
  return getCommerceMode() === 'live';
}