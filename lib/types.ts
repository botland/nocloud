export interface Product {
  id: number;
  slug: string;
  name: string;
  tier: string;
  price: number;
  description: string;
}

export interface CartService {
  name: string;
  price: number;
  key?: 'managedCare' | 'secureVaultBackup';
}

export interface CartItem {
  id: number;
  product: Product;
  services: CartService[];
  quantity: number;
  totalPrice: number;
}

// Payload sent from CheckoutModal to /api/checkout (and used for invoice mock path too).
// Email added as part of central ownership + transmission to Stripe customer.
// NOTE: prices in items are *not* trusted by server; server resolves via lib/pricing using slugs + service keys.
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
  paymentMethod: 'stripe' | 'sepa' | 'invoice';
  financing: 'full' | 'lease';
  locale?: string;
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
  paymentMethod: 'stripe' | 'sepa' | 'invoice';
  financing: 'full' | 'lease';
}
