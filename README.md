# nocloud.ai — Private Generative AI Appliances (B2B)

Next.js 16 (App Router) + Stripe (Checkout + direct subscriptions.create for leases) + next-intl (EN/FR) + Resend.

Real B2B checkout for on-premise AI hardware appliances with optional managed services and flexible payment terms (pay in full, or lease 12/24 months).

## Current Features

- **Full i18n** (EN + FR) — every string in UI, configurator, cart, checkout, success, and financing terms is translated and locale-routed (`/en`, `/fr`).
- **Real Stripe payments** (hosted Checkout + direct for leases):
  - **Direct / one-time**: full hardware amount charged immediately (services noted in description).
  - **Recurring services** (for direct/full purchases): selected services are turned into real Stripe Subscriptions (in `checkout.session.completed` for card/sepa; in the invoice creation path for pay-by-invoice). For card/sepa the PM is extracted (with listPaymentMethods fallback), set as customer default (before + after creations), passed to each sub, and retried on transient "no default" errors for reliable subsequent months. For invoice the services use send_invoice subs + first periods on the initial net30 (future months auto-sent).
  - **Leasing / financing**: hardware + services amortized into a single monthly subscription via direct `subscriptions.create` (user-requested payload style: collection_method, pending upfront via InvoiceItem for first invoice, price_data recurring item, rich metadata incl. contract_type/upfront_percent/total_value, cancel_at). Initial (upfront + month 1) paid via hosted_invoice_url (default_incomplete allows creation before PM). Post-pay the PM is attached in `invoice.paid` (with fallback) as customer/sub default for future auto-billing during the term. Small calendar-month polish to cancel_at calc for cleaner term-end (no "after" partials). The core lease creation flow (the painful part) remains otherwise untouched. Emails on paid. Works for card/sepa (lease+invoice disabled in UI).
  - **Pay by Invoice (B2B Net 30)**: Production-ready real Stripe Invoices + recurring support. For full (now including with services) we create a real Customer + Invoice (send_invoice, days=30) with hardware lines + first-period service lines (combined net30 for the order). We also create send_invoice Subscriptions for each service (future billing anchor so no duplicate first charge). Stripe auto-generates and sends month 2+ service invoices. Registered emails on creation; paid confirmations via webhook. (Lease + invoice remains UI-disabled to protect stabilized lease flow.)
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

2. Copy the example and fill real secrets (never commit env files with real keys):
   ```bash
   cp .env.example .env.development.local
   ```
   Use **`.env.development.local`** for local dev — Next.js loads it only with `next dev`, not during production build or `next start`.

   **Do not use `.env.local` on a production server.** Next.js always loads `.env.local` in production (it appears in `next build` as `Environments: .env.local, .env.production`) and its values **override** `.env.production`. Keep live secrets in **`.env.production`** only. `npm run deploy` runs `build:prod`, which refuses to build if `.env.local` is still present.
   Required keys:
   - `STRIPE_SECRET_KEY` (sk_test_...)
   - `STRIPE_WEBHOOK_SECRET` (whsec_... — required for the webhook to verify events and send emails + create service subs)
   - `RESEND_API_KEY` (re_...)
   - `ADMIN_EMAIL` (where you want order alerts)
   - `NEXT_PUBLIC_SITE_URL` (http://localhost:8080 for dev; your production domain for live)

   **Brand / white-label (optional but powerful for re-use):**
   - `NEXT_PUBLIC_BRAND_NAME=nocloud` (can be stylized, e.g. `UncloudEngine`)
   - `NEXT_PUBLIC_BRAND_TLD=.ai`
   - (optional) `NEXT_PUBLIC_BRAND_DOMAIN=...` (if your DNS/emails differ from the obvious lowercased combination)

3. Run dev (listens on 8080 per package.json):
   ```bash
   npm run dev
   ```

4. For Stripe webhooks locally: use the Stripe CLI
   ```bash
   stripe login
   stripe listen --forward-to http://localhost:8080/api/webhook/stripe
   ```
   Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in `.env.development.local`.

## Rebranding / White-labeling

You can easily change the brand name, domain, and all associated emails by setting a few environment variables (no code changes required for most re-use cases).

`BRAND_NAME` can be stylized (e.g. `UncloudEngine`), while the domain and email addresses will always be lowercased.

```bash
NEXT_PUBLIC_BRAND_NAME=UncloudEngine
NEXT_PUBLIC_BRAND_TLD=.ai
# Optional full override for the technical domain (if your DNS/emails use a different casing or subdomain)
# NEXT_PUBLIC_BRAND_DOMAIN=uncloudengine.ai
```

What changes automatically:
- Logo text in the navbar ("UncloudEngine.ai" — the name part keeps your casing, .tld is appended)
- Page titles, meta descriptions, and "Why UncloudEngine" navigation (stylized name)
- Cart item labels ("UncloudEngine Edge × 2"), footer copyright
- All email From addresses, subjects, and signatures use the stylized display name where visible (`orders@uncloudengine.ai`, "your UncloudEngine.ai order", etc.)
- Stripe product names/descriptions created during checkout
- localStorage keys (fresh cart/draft for the new brand, using lowercased slug)

What you will still do manually for a full visual rebrand:
- Replace `icons/logo.svg` and `public/favicon.*`
- Review/adjust marketing copy such as "No cloud." / "Pas de cloud." and the hero subtitle (these describe the product value, not the brand name)
- Optionally rename `package.json`, `ecosystem.config.js`, and the PM2 process name if you want a completely different project identity

See `.env.example` for the exact variable names and current defaults.

## Payment Flows (Summary)

- Choose appliances + services + quantities in configurator → cart.
- "Proceed to secure checkout" → fill B2B fields **(including email)** + choose **Payment Terms** (Pay in full vs Lease) + **Payment Method**.
- Invoice path: real Stripe Invoice (send_invoice, Net 30) is created on the backend with full B2B metadata; customer sees a friendly localized success overlay while the real invoice is sent (Stripe delivers it). Confirmation emails are produced server-side.
- Card / SEPA: real `stripe.checkout.sessions.create` (mode payment) for full/direct; for leases direct `stripe.subscriptions.create` (pending InvoiceItem for upfront + recurring price_data item) + hosted invoice for initial (upfront+1) → webhook emails + PM attach for future cycles. No client redirect to /success for lease.
- On `checkout.session.completed`:
  - Emails sent (customer + admin) with accurate details.
  - If full + services (card/sepa): real monthly service Subscriptions created (robust PM extraction + default set before/after + retry on transient no-PM errors so 2nd+ months auto-bill).
  - (Lease now uses direct sub creation path, not Checkout; legacy cancel_at code kept for compat.)

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
- `npm run test` / `npm run test:run` — Vitest (watch / single run)
- `npm run test:coverage` — Vitest with coverage report

## Testing

Functional (contract) test coverage exists under `tests/`. Tests are intentionally written to be **as independent from implementation details as possible** so they continue to provide value across future refactors of the checkout and webhook logic.

- `tests/lib/pricing.test.ts` — exhaustive table-driven tests of the single source of truth (all constants, `calculateLease`, eligibility guards, PBI/SEPA/invoice policy). These protect the business math used by both UI and server.
- `tests/api/checkout.test.ts` — black-box tests of the `/api/checkout` POST handler. Realistic `CheckoutPayload`s (prices always resolved via the pricing module) exercising the four main financing × paymentMethod paths plus all validation error cases. Mocks Stripe + Resend; asserts on response shape (`url` vs `success+invoiceId` vs `error`) and high-level call contracts (amounts, metadata fields such as `pricing_version`/`upfront_percent`/`contract_type`, lease trial/cancel_at, Resend only on invoice paths).
- `tests/api/webhook.test.ts` — event-driven tests for `checkout.session.completed` and `invoice.paid`. Covers full+services provisioning, lease PM attachment (with fallbacks), deferred lease sub creation on upfront invoice paid, standalone invoice paid, retry path, resilience to missing PMs / bad metadata, and email sending. Always asserts that the webhook returns 200.

Run with real Node (no Stripe secrets required — everything is mocked). The suite is fast and focuses on observable behavior and the stable business contract.

## Deployment Notes

- Uses PM2 (`ecosystem.config.js` names the app "nocloud", defaults to port 44444 in prod example).
- The deploy script does a clean build + restart.
- Make sure `NEXT_PUBLIC_SITE_URL` and webhook endpoint are set correctly for your domain.
- `.env` files are gitignored (`.env.example` is the committed template).

## Known Limitations / Future Ideas

- Pay by Invoice is real (send_invoice Net 30 + recurring services supported for full: combined first services on the order invoice + send subs for month 2+). Lease + invoice remains disabled in UI (lease card/sepa flow stabilized separately).
- No persistent DB — orders live in Stripe + email + metadata only.
- Webhook reacts to `checkout.session.completed` (full purchases + legacy) and `invoice.paid` (for lease upfront+recurring initial invoices). No failed payment, subscription lifecycle, or customer portal flows yet.
- Middleware deprecation warning on build (`middleware.ts` → consider "proxy" per Next 16 guidance; routing still works).
- External Font Awesome CDN (no SRI).
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

**Branch history note**: Core i18n landed on `feature/i18n-support`. Full payments + leasing (direct / recurring services / lease) on `feature/payments-leasing`. Subsequent hygiene, bug fixes (e.g. recurring pm attachment for services), polish, and docs on `fix/post-payments-issues`. Major complexity reduction pass on `refacto/reduce-complexity`: extracted stripe-customer, emails (killed ~6 duplicated templates), stripe-pm, stripe-invoices (0-trial cleanup x5+), stripe-metadata (B2B/order fields), stripe-subscriptions (recurring price_data), payment-flow (context + resolver), plus heavy use in routes. checkout/route.ts, webhook, and create-service-subscriptions all significantly smaller and better factored. All contract tests + build preserved.