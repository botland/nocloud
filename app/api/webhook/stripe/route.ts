import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Resend } from 'resend';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
const resend = new Resend(process.env.RESEND_API_KEY as string);

export async function POST(request: NextRequest) {
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

    // Extract order details from metadata (assumes checkout code passes them)
    const productTier = metadata.productTier || 'Unknown Tier';
    const services = metadata.services || 'None';
    const companyName = metadata.companyName || 'N/A';
    const vatNumber = metadata.vatNumber || 'N/A';
    const poNumber = metadata.poNumber || 'N/A';

    // Customer email - invoice / confirmation
    if (customerEmail) {
      await resend.emails.send({
        from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
        to: customerEmail,
        subject: `Thank you for your nocloud.ai order #${orderId.slice(-8)}`,
        html: `
          <h1 style="color: #0ea5e9;">Thank you for your purchase!</h1>
          <p>Your order has been received and payment confirmed.</p>
          <h2>Order Summary</h2>
          <p><strong>AI Appliance Tier:</strong> ${productTier}</p>
          <p><strong>Optional Services:</strong> ${services}</p>
          <p><strong>Total:</strong> ${amount} ${currency}</p>
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>VAT Number:</strong> ${vatNumber}</p>
          <p><strong>PO Number:</strong> ${poNumber}</p>
          <p>Order ID: ${orderId}</p>
          <p>You will receive the appliance soon. Contact us if you have any questions.</p>
          <p>Best regards,<br>The nocloud.ai Team</p>
        `,
      });
    }

    // Admin notification
    if (process.env.ADMIN_EMAIL) {
      await resend.emails.send({
        from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
        to: process.env.ADMIN_EMAIL,
        subject: `New Order Received - #${orderId.slice(-8)}`,
        html: `
          <h2>New B2B Order on nocloud.ai</h2>
          <p><strong>Customer Email:</strong> ${customerEmail || 'N/A'}</p>
          <p><strong>AI Appliance:</strong> ${productTier}</p>
          <p><strong>Services:</strong> ${services}</p>
          <p><strong>Total Paid:</strong> ${amount} ${currency}</p>
          <p><strong>Company:</strong> ${companyName}</p>
          <p><strong>VAT:</strong> ${vatNumber}</p>
          <p><strong>PO #:</strong> ${poNumber}</p>
          <p><strong>Full Session ID:</strong> ${orderId}</p>
          <p>Check Stripe dashboard for full details and fulfill the order.</p>
        `,
      });
    }

    console.log(`Order processed successfully: ${orderId}`);
  }

  return NextResponse.json({ received: true });
}
