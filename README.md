

## Admin Pre-order Fulfillment

When `NEXT_PUBLIC_COMMERCE_MODE=preorder`, customers pay a deposit at checkout. The remaining balance is charged or invoiced later by an admin when the appliance is ready to ship.

### Endpoint
`POST /api/preorder/fulfill`

**Authentication** (required):
- Header: `Authorization: Bearer YOUR_ADMIN_API_KEY`   or
- Header: `x-admin-api-key: YOUR_ADMIN_API_KEY`

Set `ADMIN_API_KEY` in your environment (never commit it).

**Request body**:
```json
{
  "depositSessionId": "cs_xxx...",     // the Stripe Checkout Session ID from the deposit
  "action": "charge" | "invoice"   // default: "charge"
}
```

**Behavior**:
- Validates the session is a paid pre-order with positive balance due.
- Idempotent: if balance was already charged or invoiced, returns early with `alreadyFulfilled: true`.
- `action=charge`: attempts off-session charge using the saved payment method from the deposit session.
- `action=invoice`: creates and sends a Net-30 Stripe Invoice for the balance.
- Returns clear errors + fallback suggestion to `invoice` when direct charge fails.

**Example (curl)**:
```bash
curl -X POST https://your-domain.com/api/preorder/fulfill \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "depositSessionId": "cs_1234567890",
    "action": "charge"
  }'
```

**Idempotency & safety**:
- Uses Stripe idempotency keys on payment intents.
- Checks `preorder_status` metadata to avoid duplicate processing.
- Requires the original deposit session to be `paid`.

Use this after hardware is ready to ship. Services (management, backup, etc.) are activated only after the balance is settled.

On charge failure, the endpoint automatically creates a Net-30 invoice, emails the customer (reason + pay link) and admin, and returns `{ success: true, method: 'invoice', fallback: true }`.

## Payment failure policy (three tiers)

| Tier | Trigger | On failure | Invoice fallback? |
|------|---------|------------|-------------------|
| **1. Deposit** | Stripe Checkout | Customer retries PM in Checkout UI | No |
| **2. Balance** | `POST /api/preorder/fulfill` charge | Auto-invoice + customer/admin emails (reason + `hosted_invoice_url`) | Yes |
| **3. Recurring** | Monthly service subscription | Stripe Billing Portal PM link + timed warning/cancel emails | No |

Tier 3 applies **equally in preorder and live mode** — recurring dunning is not gated on `NEXT_PUBLIC_COMMERCE_MODE`.

### Recurring dunning (Tier 3)

Configure in Stripe Dashboard: **Settings → Billing → Customer portal** (enable payment method update).

Environment variables:

```
RECURRING_PM_FAILURE_WARN_DAYS=7    # days after first failure → warning email + portal link
RECURRING_PM_FAILURE_CANCEL_DAYS=14 # days after first failure → cancel subscription
CRON_SECRET=...                     # optional; protects POST /api/cron/recurring-dunning
```

Daily cron (or manual):

```bash
curl -X POST https://your-domain.com/api/cron/recurring-dunning \
  -H "Authorization: Bearer $CRON_SECRET"
```

Webhook `invoice.payment_failed` handles first failure (portal link + emails). The cron progresses warn → cancel.

### Hardware serial numbers

Each appliance unit gets a unique serial at checkout: `NC-{TIER}-{HEX}` (e.g. `NC-STUDIO-A1B2C3D4E5`). Serials appear in order metadata, customer emails, and Stripe line items. Services bind to a host S/N via `hostSerialNumber`.

**Deferred post-merge:** endpoint/UI to add services to an existing S/N after subscription cancellation.

### Staging validation checklist

- [ ] Deposit retry in Stripe Checkout (declined card → customer changes PM)
- [ ] Balance fulfill with test decline card → auto-invoice + emails with S/N
- [ ] Recurring sub `invoice.payment_failed` → portal link email, **no** `send_invoice` switch
- [ ] Dunning cron: warn at `WARN_DAYS`, cancel at `CANCEL_DAYS` (simulate via metadata timestamps)
