# nocloud.ai — Next.js + Stripe + next-intl Starter

This is a clean, production-ready starter for your B2B generative AI appliance ecommerce site.

## Features
- **next-intl** for multilingual support (EN + FR)
- **Stripe Checkout** integration (real payment flow)
- B2B fields (Company, VAT, PO)
- Clean, fast, functional design
- Product configurator + cart

## Setup

1. Copy this folder into your project
2. Install dependencies:
   ```bash
   npm install
   ```

3. Add your Stripe keys in `.env.local`:
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```

4. Run the dev server:
   ```bash
   npm run dev
   ```

## Next Steps
- Connect real B2B form before checkout
- Add success page
- Connect to your database for orders
- Expand technical specs

This gives you a very strong foundation.
