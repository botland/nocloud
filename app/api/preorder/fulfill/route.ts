import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { BRAND_NAME } from '@/lib/brand';
import { extractPaymentMethodFromSession } from '@/lib/stripe-pm';
import { mapStripeErrorToMessage, extractStripeErrorCode } from '@/lib/stripe-errors';
import { buildOrderDisplayFromMetadata } from '@/lib/order-display';
import {
  sendBalancePaymentRequiredEmail,
  sendAdminOrderNotificationEmail,
} from '@/lib/emails';
import { checkRateLimit, rateLimitKeyFromRequest } from '@/lib/admin-rate-limit';

function requireAdmin(request: NextRequest): { authorized: boolean; error?: string } {
  const key = process.env.ADMIN_API_KEY;
  if (!key) {
    return { authorized: false, error: 'ADMIN_API_KEY not configured on server' };
  }
  const auth = request.headers.get('authorization') || '';
  const xKey = request.headers.get('x-admin-api-key');
  if (auth === `Bearer ${key}` || xKey === key) {
    return { authorized: true };
  }
  return { authorized: false, error: 'Invalid admin credentials' };
}

function balanceInvoiceDescription(meta: Record<string, string>): string {
  const { hardwareStr } = buildOrderDisplayFromMetadata(meta);
  const hwPart = hardwareStr && hardwareStr !== 'Standard' ? ` — ${hardwareStr}` : '';
  return `${BRAND_NAME} pre-order balance (hardware total locked at deposit)${hwPart}`;
}

async function createAndFinalizeBalanceInvoice(
  stripe: Stripe,
  customerId: string,
  balanceGross: number,
  balanceMeta: Record<string, string>,
  meta: Record<string, string>,
) {
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
    description: balanceInvoiceDescription(meta),
  });

  await stripe.invoices.finalizeInvoice(invoice.id);
  return stripe.invoices.retrieve(invoice.id);
}

async function updateDepositSessionStatus(
  stripe: Stripe,
  depositSessionId: string,
  patch: Record<string, string>,
) {
  try {
    await stripe.checkout.sessions.update(depositSessionId, { metadata: patch });
  } catch (err) {
    console.warn('Could not update deposit session metadata', depositSessionId, err);
  }
}

export async function POST(request: NextRequest) {
  const rateKey = rateLimitKeyFromRequest(request, 'preorder-fulfill');
  const rate = checkRateLimit(rateKey);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfterMs: rate.retryAfterMs },
      { status: 429 },
    );
  }

  const adminCheck = requireAdmin(request);
  if (!adminCheck.authorized) {
    return NextResponse.json({ error: adminCheck.error || 'Unauthorized' }, { status: 401 });
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
      expand: ['payment_intent.payment_method', 'customer'],
    });

    const meta = session.metadata || {};
    if (meta.order_type !== 'preorder') {
      return NextResponse.json({ error: 'Not a pre-order session' }, { status: 400 });
    }

    const currentStatus = meta.preorder_status || '';
    if (
      currentStatus.includes('balance_paid') ||
      currentStatus.includes('fulfilled')
    ) {
      return NextResponse.json({
        success: true,
        alreadyFulfilled: true,
        message: 'Balance already processed for this pre-order',
        preorderStatus: currentStatus,
      });
    }

    if (currentStatus === 'balance_invoice_sent' && action === 'charge') {
      return NextResponse.json({
        success: true,
        alreadyFulfilled: true,
        message: 'Balance invoice already sent for this pre-order',
        preorderStatus: currentStatus,
        invoiceId: meta.balance_invoice_id,
      });
    }

    const balanceNet = parseFloat(meta.quoted_balance_due || '0');
    if (!balanceNet || balanceNet <= 0) {
      return NextResponse.json({ error: 'No balance due on this pre-order' }, { status: 400 });
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Deposit session not paid yet' }, { status: 400 });
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

    const pricingVersion = meta.pricing_version || meta.pricingVersion || 'unknown';
    const orderLocale = (meta.locale as string) || 'en';
    const display = buildOrderDisplayFromMetadata(meta, pricingVersion);

    const customerEmail =
      session.customer_details?.email ||
      meta.customer_email ||
      (typeof session.customer === 'object' && session.customer && !('deleted' in session.customer)
        ? session.customer.email
        : undefined) ||
      '';

    const balanceMeta: Record<string, string> = {
      ...Object.fromEntries(
        Object.entries(meta).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)]),
      ),
      is_balance_charge: 'true',
      preorder_status: action === 'invoice' ? 'balance_invoice_sent' : 'balance_charge_pending',
      deposit_session_id: depositSessionId,
    };

    if (action === 'invoice') {
      const finalized = await createAndFinalizeBalanceInvoice(
        stripe,
        customerId,
        balanceGross,
        balanceMeta,
        meta as Record<string, string>,
      );

      await updateDepositSessionStatus(stripe, depositSessionId, {
        preorder_status: 'balance_invoice_sent',
        balance_invoice_id: finalized.id,
      });

      return NextResponse.json({
        success: true,
        method: 'invoice',
        invoiceId: finalized.id,
        hostedInvoiceUrl: finalized.hosted_invoice_url,
        balanceGross,
      });
    }

    const paymentMethod = await extractPaymentMethodFromSession(stripe, session);
    if (!paymentMethod) {
      const finalized = await createAndFinalizeBalanceInvoice(
        stripe,
        customerId,
        balanceGross,
        { ...balanceMeta, preorder_status: 'balance_invoice_sent' },
        meta as Record<string, string>,
      );

      const reason = mapStripeErrorToMessage({ code: 'charge_failed' }, orderLocale);

      if (customerEmail && finalized.hosted_invoice_url) {
        await sendBalancePaymentRequiredEmail({
          to: customerEmail,
          invoiceId: finalized.id,
          hostedInvoiceUrl: finalized.hosted_invoice_url,
          balanceAmount: balanceGross.toFixed(2),
          failureReason: reason,
          hardwareStr: display.hardwareStr,
          companyName: meta.company_name || meta.companyName,
          locale: orderLocale,
          depositSessionId,
        });
      }

      if (process.env.ADMIN_EMAIL) {
        await sendAdminOrderNotificationEmail({
          orderId: depositSessionId,
          amount: balanceGross.toFixed(2),
          currency: 'EUR',
          financing: 'full',
          servicesStr: display.servicesStr,
          hardwareStr: display.hardwareStr,
          companyName: meta.company_name || 'N/A',
          vatNumber: meta.vat_number || 'N/A',
          poNumber: meta.po_number || 'N/A',
          pricingVersion,
          locale: orderLocale,
          customerEmail,
          orderType: 'preorder',
          preorderStatus: 'balance_invoice_sent',
          balanceDue: meta.quoted_balance_due,
          quotedTotal: meta.quoted_hardware_total,
          fulfillmentAction: 'no_pm_fallback_to_invoice',
          invoiceId: finalized.id,
        });
      }

      await updateDepositSessionStatus(stripe, depositSessionId, {
        preorder_status: 'balance_invoice_sent',
        balance_invoice_id: finalized.id,
      });

      return NextResponse.json({
        success: true,
        method: 'invoice',
        fallback: true,
        reason: 'no_payment_method',
        invoiceId: finalized.id,
        hostedInvoiceUrl: finalized.hosted_invoice_url,
        balanceGross,
      });
    }

    try {
      const pi = await stripe.paymentIntents.create(
        {
          amount: Math.round(balanceGross * 100),
          currency: 'eur',
          customer: customerId,
          payment_method: paymentMethod,
          off_session: true,
          confirm: true,
          metadata: balanceMeta,
          description: balanceInvoiceDescription(meta as Record<string, string>),
        },
        { idempotencyKey: `preorder-balance-${depositSessionId}` },
      );

      await updateDepositSessionStatus(stripe, depositSessionId, {
        preorder_status: 'balance_charge_pending',
        balance_payment_intent_id: pi.id,
      });

      return NextResponse.json({
        success: true,
        method: 'charge',
        paymentIntentId: pi.id,
        status: pi.status,
        balanceGross,
      });
    } catch (chargeErr: unknown) {
      const code = extractStripeErrorCode(chargeErr);
      const reason = mapStripeErrorToMessage(chargeErr, orderLocale);

      const finalized = await createAndFinalizeBalanceInvoice(
        stripe,
        customerId,
        balanceGross,
        { ...balanceMeta, preorder_status: 'balance_invoice_sent', charge_failure_code: code },
        meta as Record<string, string>,
      );

      if (customerEmail && finalized.hosted_invoice_url) {
        await sendBalancePaymentRequiredEmail({
          to: customerEmail,
          invoiceId: finalized.id,
          hostedInvoiceUrl: finalized.hosted_invoice_url,
          balanceAmount: balanceGross.toFixed(2),
          failureReason: reason,
          hardwareStr: display.hardwareStr,
          companyName: meta.company_name || meta.companyName,
          locale: orderLocale,
          depositSessionId,
        });
      }

      if (process.env.ADMIN_EMAIL) {
        await sendAdminOrderNotificationEmail({
          orderId: depositSessionId,
          amount: balanceGross.toFixed(2),
          currency: 'EUR',
          financing: 'full',
          servicesStr: display.servicesStr,
          hardwareStr: display.hardwareStr,
          companyName: meta.company_name || 'N/A',
          vatNumber: meta.vat_number || 'N/A',
          poNumber: meta.po_number || 'N/A',
          pricingVersion,
          locale: orderLocale,
          customerEmail,
          orderType: 'preorder',
          preorderStatus: 'balance_invoice_sent',
          balanceDue: meta.quoted_balance_due,
          quotedTotal: meta.quoted_hardware_total,
          fulfillmentAction: 'charge_failed_fallback_to_invoice',
          invoiceId: finalized.id,
        });
      }

      await updateDepositSessionStatus(stripe, depositSessionId, {
        preorder_status: 'balance_invoice_sent',
        balance_invoice_id: finalized.id,
        charge_failure_code: code,
      });

      return NextResponse.json({
        success: true,
        method: 'invoice',
        fallback: true,
        code,
        invoiceId: finalized.id,
        hostedInvoiceUrl: finalized.hosted_invoice_url,
        balanceGross,
      });
    }
  } catch (err: any) {
    console.error('Preorder fulfill error', err);
    return NextResponse.json({ error: err.message || 'Fulfill failed' }, { status: 500 });
  }
}