import type { HardwareCustomization } from './pricing';
import type { PriceBadge } from './promotions';

export interface Product {
  id: number;
  slug: string;
  name: string;
  tier: string;
  price: number;
  listPrice?: number;
  description: string;
  promotionBadge?: PriceBadge;
  promotionBadges?: PriceBadge[];
}

export interface CartService {
  name: string;
  price: number;
  listPrice?: number;
  key?: 'managedCare' | 'secureVaultBackup';
  promotionBadgeKey?: string;
  promotionKind?: 'promotion' | 'launch_free';
  launchFreeUntil?: string;
  promoEndsAt?: string;
}

export interface CartItem {
  id: number;
  product: Product;
  services: CartService[];
  quantity: number;
  totalPrice: number;
  // Optional hardware customization (RAM/VRAM/Disk). When present the values come from
  // the tier's pre-select options in lib/pricing.ts. Server always re-prices using the
  // central calculateHardwarePrice + chosen values (client totalPrice is never trusted).
  customization?: HardwareCustomization;
}

// Payload sent from CheckoutModal to /api/checkout (and used for invoice mock path too).
// Email added as part of central ownership + transmission to Stripe customer.
// NOTE: prices in items are *not* trusted by server; server resolves via lib/pricing using slugs + service keys.
// recurringPaymentMethod (only sent for paymentMethod==='invoice' + services) lets the user pick
// card/sepa for the recurring services while the main hardware/upfront uses Net-30 invoice.
export interface CheckoutPayload {
  items: CartItem[];
  email: string;
  company: string;
  vatNumber?: string;
  poNumber?: string;
  address: string;
  city: string;
  postal?: string;
  country: string;
  /** When true, delivery fields are required and sent to Stripe as shipping (separate from billing). */
  deliveryDifferent?: boolean;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryPostal?: string;
  deliveryCountry?: string;
  paymentMethod: 'stripe' | 'sepa' | 'invoice';
  financing: 'full' | 'lease';
  locale?: string;
  recurringPaymentMethod?: 'stripe' | 'sepa';
  // order_placed_at (unix seconds) is the canonical reference for the new
  // "recurring payments start exactly 1 month after order time" rule (non-trial,
  // via billing_cycle_anchor). Captured at successful /api/checkout response.
  order_placed_at?: number;
  /**
   * Customer's explicit choice (only relevant/sent when the UI offered the checkbox
   * and the determination allowed it). Server is authoritative: illegal choices are rejected.
   * When true + allowed: VAT is charged (gross amounts sent to Stripe); net + legal treatment otherwise.
   */
  vatInclusive?: boolean;
}

// Draft of checkout form data persisted across Stripe cancel so user doesn't have to re-type everything.
export interface CheckoutFormDraft {
  email: string;
  company: string;
  vatNumber: string;
  poNumber: string;
  address: string;
  city: string;
  postal: string;
  country: string;
  deliveryDifferent?: boolean;
  deliveryAddress?: string;
  deliveryCity?: string;
  deliveryPostal?: string;
  deliveryCountry?: string;
  paymentMethod: 'stripe' | 'sepa' | 'invoice';
  financing: 'full' | 'lease';
  // Only relevant when paymentMethod==='invoice' and cart has recurring services.
  // Lets the user choose automatic collection (card/sepa) for the recurring part while
  // the hardware/upfront still goes through the Net-30 invoice.
  recurringPaymentMethod?: 'stripe' | 'sepa';
  // order_placed_at captured for the uniform "recurring (services + lease hardware)
  // start exactly 1 month after order time" rule (non-trial via billing_cycle_anchor).
  order_placed_at?: number;
  /**
   * Persisted customer choice for VAT-inclusive (see CheckoutPayload).
   * Only sent when offered; server validates.
   */
  vatInclusive?: boolean;
}
