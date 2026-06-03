import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Resend } from 'resend';

export async function POST(request: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: '2025-02-24.acacia',
  });

  const body = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string
    );
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: 'Webhook error' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    const customerEmail = session.customer_details?.email;
    const orderId = session.id;
    const metadata = session.metadata || {};
    const amount = session.amount_total ? (session.amount_total / 100).toFixed(2) : '0.00';
    const currency = session.currency?.toUpperCase() || 'EUR';

    // Rich metadata from the new checkout API (falls back gracefully for old calls)
    const companyName = metadata.company_name || metadata.companyName || 'N/A';
    const vatNumber = metadata.vat_number || metadata.vatNumber || 'N/A';
    const poNumber = metadata.po_number || metadata.poNumber || 'N/A';
    const financing = metadata.financing || 'full';
    const leaseMonths = metadata.lease_months || '';
    const leaseCancelAt = metadata.lease_cancel_at || '';

    let servicesStr = 'None';
    let servicesArray: Array<{ name: string; price: number }> = [];
    try {
      if (metadata.services) {
        servicesArray = JSON.parse(metadata.services);
        servicesStr = servicesArray.map(s => `${s.name} (€${s.price}/mo)`).join(', ') || 'None';
      }
    } catch {}

    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    // Customer email - invoice / confirmation
    if (customerEmail && resend) {
      const leaseNote = financing === 'lease' ? `<p><strong>Lease term:</strong> ${leaseMonths || '?'} months</p>` : '';
      await resend.emails.send({
        from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
        to: customerEmail,
        subject: `Thank you for your nocloud.ai order #${orderId.slice(-8)}`,
        html: `
          <h1 style="color: #0ea5e9;">Thank you for your purchase!</h1>
          <p>Your order has been received and payment confirmed.</p>
          <h2>Order Summary</h2>
          <p><strong>Total:</strong> ${amount} ${currency}</p>
          <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
          <p><strong>Optional Services:</strong> ${servicesStr}</p>
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>VAT Number:</strong> ${vatNumber}</p>
          <p><strong>PO Number:</strong> ${poNumber}</p>
          <p>Order ID: ${orderId}</p>
          ${leaseNote}
          <p>You will receive the appliance soon. Contact us if you have any questions.</p>
          <p>Best regards,<br>The nocloud.ai Team</p>
        `,
      });
    }

    // Admin notification
    if (process.env.ADMIN_EMAIL && resend) {
      await resend.emails.send({
        from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
        to: process.env.ADMIN_EMAIL,
        subject: `New Order Received - #${orderId.slice(-8)}`,
        html: `
          <h2>New B2B Order on nocloud.ai</h2>
          <p><strong>Customer Email:</strong> ${customerEmail || 'N/A'}</p>
          <p><strong>Total Paid:</strong> ${amount} ${currency}</p>
          <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
          <p><strong>Services:</strong> ${servicesStr}</p>
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>VAT:</strong> ${vatNumber}</p>
          <p><strong>PO #:</strong> ${poNumber}</p>
          <p><strong>Full Session ID:</strong> ${orderId}</p>
          <p>Check Stripe dashboard for full details and fulfill the order.</p>
        `,
      });
    }

    // For direct purchases, turn selected services into real recurring Subscriptions
    // (the customer + payment method from the one-time Checkout can be reused)
    if (session.customer && financing !== 'lease' && servicesArray.length > 0) {
      for (const s of servicesArray) {
        try {
          await stripe.subscriptions.create({
            customer: session.customer as string,
            items: [{
              price_data: {
                currency: 'eur',
                unit_amount: Math.round(s.price * 100),
                product_data: { name: s.name },
                recurring: { interval: 'month' },
              } as any,
            }],
            metadata: {
              order_session: orderId,
              service: s.name,
            },
          });
        } catch (subErr) {
          console.error('Failed to create service subscription', subErr);
        }
      }
    }

    // For lease mode, set cancel_at on the subscription AFTER it's created by Checkout.
    // subscription_data.cancel_at is not a supported parameter when creating
    // Checkout sessions (even with recent API versions).
    if (financing === 'lease' && session.subscription && leaseCancelAt) {
      try {
        await stripe.subscriptions.update(session.subscription as string, {
          cancel_at: parseInt(leaseCancelAt, 10),
        });
        console.log(`Set cancel_at on lease subscription ${session.subscription} for order ${orderId}`);
      } catch (updateErr: any) {
        console.error('Failed to set cancel_at on lease subscription', updateErr);
      }
    }

    console.log(`Order processed successfully: ${orderId}`);
  }

  return NextResponse.json({ received: true });
}
