# nocloud.ai — Private Generative AI Appliances (B2B)

Next.js 16 (App Router) + Stripe Checkout + next-intl (EN/FR) + Resend.

Real B2B checkout for on-premise AI hardware appliances with optional managed services and flexible payment terms (pay in full, or lease 12/24 months).

## Current Features

- **Full i18n** (EN + FR) — every string in UI, configurator, cart, checkout, success, and financing terms is translated and locale-routed (`/en`, `/fr`).
- **Real Stripe payments** (hosted Checkout):
  - **Direct / one-time**: full hardware amount charged immediately (services noted in description).
  - **Recurring services** (for direct purchases): selected Managed Care (€89/mo) and/or SecureVault Backup (€39/mo) are turned into real Stripe Subscriptions in the `checkout.session.completed` webhook using the collected payment method.
  - **Leasing / financing**: hardware + services amortized into a single monthly subscription. 12 months if hardware total < €10k, else 24 months. Fixed term enforced via `subscriptions.update({ cancel_at })` (computed at checkout time and stored in metadata).
- **B2B data collection**: Company name, email address, VAT/SIRET, PO number, full billing address + country selector. Email is collected in the checkout form (kept by us), transmitted to Stripe (prefill + explicit Customer creation with metadata). All passed through to Stripe metadata, Customer records, and order emails.
- **Payment methods**: Card (Stripe), SEPA Direct Debit, or "Pay by Invoice (B2B)" mock (Net 30).
- **Cart + Configurator**: quantity selector, optional monthly services per appliance, live totals (hardware one-time + services monthly).
- **Success page**: localized thank-you + optional `session_id` reference. Returns to correct locale.
- **Emails**: customer confirmation + admin notification via Resend on successful checkout (includes financing details, services list, B2B info).
- **Rich metadata** on Stripe objects for reconciliation.
- **Centralized pricing & customer ownership**: All hardware prices, service rates, lease rules (12/24mo + €10k threshold), and SEPA cap live in one place (`lib/pricing.ts` + `PRICING_VERSION`). Email captured in checkout form and used to create explicit Stripe Customer records (with B2B metadata attached to the durable customer object). This means we keep the data ourselves (in our emails + payload) and still own the customer records even while using Stripe for processing. Price changes affect only new orders; prior subscriptions keep their purchased rates.
- Clean dark UI, Font Awesome icons, fully responsive.

## Setup

1. Install:
   ```bash
   npm install
   ```

2. Copy the example and fill real secrets (never commit `.env.local`):
   ```bash
   cp .env.example .env.local
   ```
   Required keys:
   - `STRIPE_SECRET_KEY` (sk_test_...)
   - `STRIPE_WEBHOOK_SECRET` (whsec_... — required for the webhook to verify events and send emails + create service subs)
   - `RESEND_API_KEY` (re_...)
   - `ADMIN_EMAIL` (where you want order alerts)
   - `NEXT_PUBLIC_SITE_URL` (http://localhost:8080 for dev; your production domain for live)

3. Run dev (listens on 8080 per package.json):
   ```bash
   npm run dev
   ```

4. For Stripe webhooks locally: use the Stripe CLI
   ```bash
   stripe login
   stripe listen --forward-to http://localhost:8080/api/webhook/stripe
   ```
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in `.env.local`.

## Payment Flows (Summary)

- Choose appliances + services + quantities in configurator → cart.
- "Proceed to secure checkout" → fill B2B fields **(including email)** + choose **Payment Terms** (Pay in full vs Lease) + **Payment Method**.
- Invoice path: shows a localized fake success overlay (B2B Net 30, no real charge).
- Card / SEPA: real `stripe.checkout.sessions.create` (mode payment or subscription for lease) → hosted Stripe Checkout → success or cancel.
- On `checkout.session.completed`:
  - Emails sent (customer + admin) with accurate details.
  - If direct + services selected: real monthly Subscriptions created for each service (with the collected pm attached).
  - If lease: the subscription (created by Checkout) gets `cancel_at` set from metadata.

Lease math (server + client consistent, centralized in `lib/pricing.ts`):
- months = hardwareTotal < LEASE_THRESHOLD ? 12 : 24
- monthly = Math.ceil(hardwareTotal / months) + servicesMonthly
(See `calculateLease()` and `PRICING_VERSION` for the current values + change-over-time handling.)

## Scripts

- `npm run dev` — dev server on :8080
- `npm run build` — production build (Turbopack)
- `npm run start` — production server
- `npm run lint` — neutralized (no ESLint config yet)
- `npm run deploy` — example PM2 deploy script (see ecosystem.config.js — customize for your env/port)

## Deployment Notes

- Uses PM2 (`ecosystem.config.js` names the app "nocloud", defaults to port 44444 in prod example).
- The deploy script does a clean build + restart.
- Make sure `NEXT_PUBLIC_SITE_URL` and webhook endpoint are set correctly for your domain.
- `.env` files are gitignored (`.env.example` is the committed template).

## Known Limitations / Future Ideas

- Invoice method is still a mock (easy to extend to real Stripe Invoices later).
- No persistent DB — orders live in Stripe + email + metadata only.
- Webhook only reacts to `checkout.session.completed` (no failed payment, subscription lifecycle, or customer portal flows yet).
- Middleware deprecation warning on build (`middleware.ts` → consider "proxy" per Next 16 guidance; routing still works).
- External Font Awesome CDN (no SRI).
- No automated tests.
- (Prices, service rates, lease threshold, and SEPA limit are now centralized in `lib/pricing.ts` with `PRICING_VERSION` for history.)
- ~~Client price tampering possible (fixed: server now resolves all amounts from lib/pricing.ts using slugs/keys).~~
- ~~Emails could fail and skip side effects (fixed: wrapped, processing always continues).~~
- ~~Canceled banner never triggered from Stripe (fixed).~~
- ~~Recurring price labels leaked English in FR (fixed via common i18n keys).~~
- ~~Order emails always English (basic FR support added; full template i18n possible).~~
- ~~Missing custom fonts (Inter + Space Grotesk) despite CSS prep (fixed via next/font).~~
- ~~Price tampering vector and invoice success used unsafe interpolation (fixed).~~

This is a production-ready foundation for a European B2B appliance sales site with sophisticated financing.

## License / Credits

Private project. Built with Next.js, Stripe, next-intl, Resend, Tailwind.

---

**Branch history note**: Core i18n landed on `feature/i18n-support`. Full payments + leasing (direct / recurring services / lease) on `feature/payments-leasing`. Subsequent hygiene, bug fixes (e.g. recurring pm attachment for services), polish, and docs on `fix/post-payments-issues`.