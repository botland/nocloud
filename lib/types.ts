export interface Product {
  id: number;
  slug: string;
  name: string;
  tier: string;
  price: number;
  description: string;
}

export interface CartItem {
  id: number;
  product: Product;
  services: Array<{ name: string; price: number }>;
  quantity: number;
  totalPrice: number;
}

// Payload sent from CheckoutModal to /api/checkout (and used for invoice mock path too).
// Email added as part of central ownership + transmission to Stripe customer.
export interface CheckoutPayload {
  items: any[];
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
