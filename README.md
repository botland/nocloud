# nocloud.ai — Private Generative AI Appliances (B2B)

Next.js 16 (App Router) + Stripe (Checkout + direct subscriptions.create for leases) + next-intl (EN/FR) + Resend.

Real B2B checkout for on-premise AI hardware appliances with optional managed services and flexible payment terms (pay in full, or lease 12/24 months).

## Current Features

- **Full i18n** (EN + FR) — every string in UI, configurator, cart, checkout, success, and financing terms is translated and locale-routed (`/en`, `/fr`).
- **Real Stripe payments** (hosted Checkout + direct for leases):
  - **Direct / one-time**: full hardware amount charged immediately (services noted in description).
  - **Recurring services** (for direct purchases): selected Managed Care (€89/mo) and/or SecureVault Backup (€39/mo) are turned into real Stripe Subscriptions in the `checkout.session.completed` webhook. The PM collected during the one-time Checkout is explicitly attached as the customer's default and passed to each service subscription so monthly recurring auto-bills reliably (especially important for SEPA).
  - **Leasing / financing**: hardware + services amortized into a single monthly subscription (direct `subscriptions.create` with `payment_behavior: 'default_incomplete'` so it can be created before a PM exists). Upfront % is attached via a pending InvoiceItem (added to the first invoice). The customer pays the initial invoice (upfront + month 1) on the subscription's `hosted_invoice_url`. After successful payment, the PM is explicitly attached (in the `invoice.paid` handler) as the default on the customer and the lease subscription for reliable future recurring cycles under the subscription's `cancel_at`. The lease creation/redirect/initial-payment logic was left completely untouched (it was a painful stabilization process). Confirmation emails sent from `invoice.paid` webhook. Rich metadata (contract_type, upfront_percent, total_value, etc.) is preserved.
  - **Pay by Invoice (B2B Net 30)**: Now production-ready real Stripe Invoices (previously a client-only mock with no objects or server emails). For allowed cases (full, no services, within PBI range) we create a real Customer + Invoice with `collection_method: 'send_invoice'`, `days_until_due: 30`, full B2B metadata, finalize and send it. Friendly client overlay is still shown; server sends registered emails. Policy still prevents mixing with recurring services. When the customer later pays the net30 invoice, `invoice.paid` can be used for settlement confirmation.
- **B2B data collection**: Company name, email address, VAT/SIRET, PO number, full billing address + country selector. Email is collected in the checkout form (kept by us), transmitted to Stripe (prefill + explicit Customer creation with metadata). All passed through to Stripe metadata, Customer records, and order emails.
- **Payment methods**: Card (Stripe), SEPA Direct Debit, or "Pay by Invoice (B2B)" (now real Net 30 Stripe Invoices).
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
- Invoice path: real Stripe Invoice (send_invoice, Net 30) is created on the backend with full B2B metadata; customer sees a friendly localized success overlay while the real invoice is sent (Stripe delivers it). Confirmation emails are produced server-side.
- Card / SEPA: real `stripe.checkout.sessions.create` (mode payment) for full/direct purchases; for leases we use direct `stripe.subscriptions.create` (with add_invoice_items) and redirect to the invoice's hosted payment page → success emails via webhook (no automatic client redirect to /success for the lease payment completion).
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

- Pay by Invoice is now real (Stripe send_invoice + Net 30). The previous policy that restricted it to full/no-services orders is retained (to limit admin work for recurring on net-30).
- No persistent DB — orders live in Stripe + email + metadata only.
- Webhook reacts to `checkout.session.completed` (full purchases + legacy) and `invoice.paid` (for lease upfront+recurring initial invoices). No failed payment, subscription lifecycle, or customer portal flows yet.
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