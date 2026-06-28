

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
