import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Resend } from 'resend';

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Webhook misconfigured: missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string, {
    apiVersion: '2026-05-27.dahlia' as any,
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
    const pricingVersion = metadata.pricing_version || metadata.pricingVersion || 'unknown';
    const orderLocale = (metadata.locale as string) || 'en';
    const isFr = orderLocale === 'fr';

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
      try {
        const thanksSubj = isFr
          ? `Merci pour votre commande nocloud.ai #${orderId.slice(-8)}`
          : `Thank you for your nocloud.ai order #${orderId.slice(-8)}`;
        const thanksTitle = isFr ? 'Merci pour votre achat !' : 'Thank you for your purchase!';
        const thanksBody = isFr ? 'Votre commande a été reçue et le paiement confirmé.' : 'Your order has been received and payment confirmed.';
        const thanksSummary = isFr ? 'Récapitulatif de commande' : 'Order Summary';
        const thanksServices = isFr ? 'Services optionnels' : 'Optional Services';
        const thanksCompany = isFr ? 'Société' : 'Company';
        const thanksVat = isFr ? 'Numéro de TVA' : 'VAT Number';
        const thanksPo = isFr ? 'N° de commande' : 'PO Number';
        const thanksPriceVer = isFr ? 'Version de tarification' : 'Pricing version';
        const thanksFooter = isFr ? 'Vous recevrez l\'appareil prochainement. Contactez-nous si vous avez des questions.' : 'You will receive the appliance soon. Contact us if you have any questions.';
        const thanksClose = isFr ? 'Cordialement,<br>L\'équipe nocloud.ai' : 'Best regards,<br>The nocloud.ai Team';
        await resend.emails.send({
          from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
          to: customerEmail,
          subject: thanksSubj,
          html: `
            <h1 style="color: #0ea5e9;">${thanksTitle}</h1>
            <p>${thanksBody}</p>
            <h2>${thanksSummary}</h2>
            <p><strong>Total:</strong> ${amount} ${currency}</p>
            <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
            <p><strong>${thanksServices}:</strong> ${servicesStr}</p>
            <p><strong>${thanksCompany}:</strong> ${companyName}</p>
            <p><strong>${thanksVat}:</strong> ${vatNumber}</p>
            <p><strong>${thanksPo}:</strong> ${poNumber}</p>
            <p>Order ID: ${orderId}</p>
            <p><strong>${thanksPriceVer}:</strong> ${pricingVersion}</p>
            ${leaseNote}
            <p>${thanksFooter}</p>
            <p>${thanksClose}</p>
          `,
        });
      } catch (emailErr) {
        console.error('Failed to send customer email for order', orderId, emailErr);
      }
    }

    // Admin notification
    if (process.env.ADMIN_EMAIL && resend) {
      try {
        const adminSubj = isFr
          ? `Nouvelle commande B2B sur nocloud.ai - #${orderId.slice(-8)}`
          : `New Order Received - #${orderId.slice(-8)}`;
        const adminTitle = isFr ? 'Nouvelle commande B2B sur nocloud.ai' : 'New B2B Order on nocloud.ai';
        const adminCheck = isFr ? 'Vérifiez le tableau de bord Stripe pour tous les détails et pour exécuter la commande.' : 'Check Stripe dashboard for full details and fulfill the order.';
        await resend.emails.send({
          from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
          to: process.env.ADMIN_EMAIL,
          subject: adminSubj,
          html: `
            <h2>${adminTitle}</h2>
            <p><strong>Customer Email:</strong> ${customerEmail || 'N/A'}</p>
            <p><strong>Total Paid:</strong> ${amount} ${currency}</p>
            <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
            <p><strong>Services:</strong> ${servicesStr}</p>
            <p><strong>Company:</strong> ${companyName}</p>
            <p><strong>VAT:</strong> ${vatNumber}</p>
            <p><strong>PO #:</strong> ${poNumber}</p>
            <p><strong>Full Session ID:</strong> ${orderId}</p>
            <p><strong>Pricing version:</strong> ${pricingVersion}</p>
            <p>${adminCheck}</p>
          `,
        });
      } catch (emailErr) {
        console.error('Failed to send admin email for order', orderId, emailErr);
      }
    }

    // For direct purchases (financing=full), turn selected services into real recurring Subscriptions.
    // The pm collected by the one-time Checkout session must be explicitly attached so the
    // monthly subs can actually charge (without this, subs are often created without a default pm
    // and won't auto-bill, especially noticeable with SEPA).
    if (session.customer && financing !== 'lease' && servicesArray.length > 0) {
      // Best-effort: extract the payment method used for this Checkout payment.
      // In 'payment' mode the pm may be directly on session or reachable via the payment_intent.
      let defaultPaymentMethod: string | undefined;
      const sessionPm = (session as any).payment_method as string | undefined;
      if (sessionPm) {
        defaultPaymentMethod = sessionPm;
      } else if (session.payment_intent) {
        try {
          const pi = await stripe.paymentIntents.retrieve(
            session.payment_intent as string,
            { expand: ['payment_method'] }
          );
          const pm = (pi as any).payment_method;
          defaultPaymentMethod = typeof pm === 'string' ? pm : pm?.id;
        } catch (retrieveErr) {
          console.warn('Could not expand payment_intent to obtain payment_method for service subs', retrieveErr);
        }
      }

      // Also set it as the customer's default so any future subscriptions (or retries) work.
      if (defaultPaymentMethod) {
        try {
          await stripe.customers.update(session.customer as string, {
            invoice_settings: { default_payment_method: defaultPaymentMethod },
          });
        } catch (custErr) {
          console.warn('Could not set default pm on customer', custErr);
        }
      }

      for (const s of servicesArray) {
        try {
          const subParams: any = {
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
          };
          if (defaultPaymentMethod) {
            subParams.default_payment_method = defaultPaymentMethod;
          }
          await stripe.subscriptions.create(subParams);
          console.log(`Created service subscription for "${s.name}" on customer ${session.customer} (pm: ${defaultPaymentMethod || 'none'})`);
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
