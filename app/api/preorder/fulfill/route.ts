import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { BRAND_NAME } from '@/lib/brand';
import { extractPaymentMethodFromSession } from '@/lib/stripe-pm';

function requireAdmin(request: NextRequest): boolean {
  const key = process.env.ADMIN_API_KEY;
  if (!key) return false;
  const auth = request.headers.get('authorization') || '';
  return auth === `Bearer ${key}` || request.headers.get('x-admin-api-key') === key;
}

export async function POST(request: NextRequest) {
  if (!requireAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia' as any,
  });

  try {
    const body = await request.json();
    const { depositSessionId, action = 'charge' } = body as {
      depositSessionId?: string;
      action?: 'charge' | 'invoice';
    };

    if (!depositSessionId) {
      return NextResponse.json({ error: 'depositSessionId required' }, { status: 400 });
    }

    const session = await stripe.checkout.sessions.retrieve(depositSessionId, {
      expand: ['payment_intent.payment_method'],
    });

    const meta = session.metadata || {};
    if (meta.order_type !== 'preorder') {
      return NextResponse.json({ error: 'Not a pre-order session' }, { status: 400 });
    }

    const balanceNet = parseFloat(meta.quoted_balance_due || '0');
    if (!balanceNet || balanceNet <= 0) {
      return NextResponse.json({ error: 'No balance due on this pre-order' }, { status: 400 });
    }

    const customerId = typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id;

    if (!customerId) {
      return NextResponse.json({ error: 'No Stripe customer on pre-order session' }, { status: 400 });
    }

    const chargesVat = meta.vat_charged === 'true';
    const vatRate = meta.vat_rate ? parseFloat(meta.vat_rate) : 0;
    const balanceGross = chargesVat && vatRate > 0
      ? Math.round((balanceNet * (1 + vatRate)) * 100) / 100
      : balanceNet;

    const balanceMeta: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(meta).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
      ),
      is_balance_charge: 'true',
      preorder_status: action === 'invoice' ? 'balance_invoice_sent' : 'balance_charge_pending',
      deposit_session_id: depositSessionId,
    };

    if (action === 'invoice') {
      const invoice = await stripe.invoices.create({
        customer: customerId,
        collection_method: 'send_invoice',
        days_until_due: 30,
        auto_advance: true,
        metadata: balanceMeta,
      });

      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        amount: Math.round(balanceGross * 100),
        currency: 'eur',
        description: `${BRAND_NAME} pre-order balance (hardware total locked at deposit)`,
      });

      await stripe.invoices.finalizeInvoice(invoice.id);

      return NextResponse.json({
        success: true,
        method: 'invoice',
        invoiceId: invoice.id,
        balanceGross,
      });
    }

    const paymentMethod = await extractPaymentMethodFromSession(stripe, session);
    if (!paymentMethod) {
      return NextResponse.json({
        error: 'No saved payment method. Use action=invoice for Pay-by-Invoice fallback.',
        fallback: 'invoice',
      }, { status: 422 });
    }

    try {
      const pi = await stripe.paymentIntents.create({
        amount: Math.round(balanceGross * 100),
        currency: 'eur',
        customer: customerId,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        metadata: balanceMeta,
        description: `${BRAND_NAME} pre-order balance`,
      });

      return NextResponse.json({
        success: true,
        method: 'charge',
        paymentIntentId: pi.id,
        status: pi.status,
        balanceGross,
      });
    } catch (chargeErr: any) {
      const code = chargeErr?.code || chargeErr?.decline_code || 'charge_failed';
      return NextResponse.json({
        error: chargeErr?.message || 'Off-session charge failed',
        code,
        fallback: 'invoice',
      }, { status: 422 });
    }
  } catch (err: any) {
    console.error('Preorder fulfill error', err);
    return NextResponse.json({ error: err.message || 'Fulfill failed' }, { status: 500 });
  }
}