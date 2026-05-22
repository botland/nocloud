export interface Product {
  id: number;
  slug: string;
  name: string;
  tier: string;
  price: number;
  description: string;
  techSpecs?: Record<string, string>;
}

export interface CartItem {
  id: number;
  product: Product;
  services: Array<{ name: string; price: number }>;
  totalPrice: number;
}