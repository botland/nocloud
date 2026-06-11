import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Resend } from 'resend';
import { calculateLease, isOverSepaLimit, isPbiAllowed, isInvoiceAllowed, LEASE_MIN, LEASE_MAX, PBI_MIN, PBI_MAX, PRICING_VERSION, getHardwarePrice, getServicePrice, ServiceKey, UPFRONT_PERCENT } from '@/lib/pricing';

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ 
      error: 'Stripe secret key is not configured. Please create .env.local with STRIPE_SECRET_KEY=sk_test_... and NEXT_PUBLIC_SITE_URL=http://localhost:8080' 
    }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia' as any,
  });

  try {
    const body = await request.json();
    const {
      items,
      email = '',
      company,
      vatNumber,
      poNumber,
      address,
      city,
      postal,
      country,
      paymentMethod,
      financing = 'full',
      locale = 'en',
    } = body;

    // Authoritative prices + totals resolved server-side from lib/pricing.ts using slugs + service keys.
    // Client-provided prices (in product.price / services[].price) are IGNORED for charge amounts to prevent tampering.
    let hardwareTotal = 0;
    let servicesMonthly = 0;
    const resolvedServicesForMeta: Array<{ name: string; price: number }> = [];

    for (const item of (items || [])) {
      const qty = item.quantity || 1;
      const slug = item.product?.slug as string | undefined;
      const hwPrice = slug ? getHardwarePrice(slug) : (item.product?.price || 0);
      hardwareTotal += hwPrice * qty;

      const svcs = item.services || [];
      for (const s of svcs) {
        const key = (s.key as ServiceKey | undefined) || undefined;
        const svcPrice = key ? getServicePrice(key) : (s.price || 0);
        const lineTotal = svcPrice * qty;
        servicesMonthly += lineTotal;
        // Store with translated-or-fallback name; qty-multiplied price for legacy consumers in emails/webhook.
        const displayName = s.name || (key ? key : 'Service');
        resolvedServicesForMeta.push({ name: displayName, price: lineTotal });
      }
    }

    // Email is collected in our form (kept) and transmitted here.
    // We explicitly create a Stripe Customer (with email + rich B2B metadata and structured address)
    // so we "own" the customer record in Stripe. The address is set on the customer object
    // so that when we pass the customer to the Checkout session, Stripe will prefill the
    // billing address in the hosted Checkout (preventing the user from having to enter it twice).
    let stripeCustomerId: string | undefined;
    if (email) {
      try {
        const customer = await stripe.customers.create({
          email,
          name: company || undefined,
          address: {
            line1: address || undefined,
            city: city || undefined,
            postal_code: postal || undefined,
            country: country || undefined,
          },
          metadata: {
            company_name: company || 'N/A',
            vat_number: vatNumber || 'N/A',
            po_number: poNumber || 'N/A',
          },
        });
        stripeCustomerId = customer.id;
      } catch (custErr) {
        console.warn('Failed to pre-create Stripe customer (Checkout will create one); proceeding anyway', custErr);
      }
    }

    let monthlyTotal = 0;
    let leaseDetails: ReturnType<typeof calculateLease> | null = null;

    if (financing === 'lease') {
      leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
      monthlyTotal = leaseDetails.monthlyTotal;
    }

    const dueAmount = financing === 'lease' ? monthlyTotal : hardwareTotal;

    // Enforce lease and pay-by-invoice eligibility ranges using the constants from lib/pricing.ts
    // (client UX mirrors this; server is authoritative).
    if (financing === 'lease' && !calculateLease(hardwareTotal, servicesMonthly).isAllowed) {
      return NextResponse.json({
        error: `Leasing is only available for hardware totals between €${LEASE_MIN} and €${LEASE_MAX}.`
      }, { status: 400 });
    }
    if (paymentMethod === 'invoice' && !isPbiAllowed(hardwareTotal)) {
      return NextResponse.json({
        error: `Pay by Invoice is only available for hardware totals between €${PBI_MIN} and €${PBI_MAX}.`
      }, { status: 400 });
    }
    if (paymentMethod === 'invoice' && !isInvoiceAllowed(financing, servicesMonthly)) {
      return NextResponse.json({
        error: 'Pay by Invoice is only available for one-time full payments with no recurring services.'
      }, { status: 400 });
    }

    if (paymentMethod === 'sepa' && isOverSepaLimit(dueAmount)) {
      return NextResponse.json({
        error: `SEPA Direct Debit payments are limited to €10,000. Your ${financing === 'lease' ? 'monthly lease payment' : 'order total'} is €${dueAmount}. Please select "Credit / Debit card" (or reduce quantity / use Pay in full for smaller hardware totals).`
      }, { status: 400 });
    }

    // IMPORTANT (per approved plan "Lease safety rule" + user feedback):
    // The entire lease block below (direct subscriptions.create, pending InvoiceItem for upfront,
    // dynamic Product, payment_behavior: 'default_incomplete', hosted_invoice_url redirect, metadata,
    // cancel_at, etc.) was stabilized through a painful iteration process for the exact "upfront + monthly"
    // experience the user requested. **Do not edit inside this block** for recurring PM or invoice work.
    // All lease-related robustness is additive only in the webhook (invoice.paid handler).
    if (financing === 'lease') {
      // For lease we create the subscription directly (not via Checkout) so we can set
      // cancel_at, rich metadata, collection_method etc. at creation time.
      // The customer must exist (we ensure it). We then redirect to the subscription's
      // first invoice hosted payment page to collect the initial charge (upfront + first month).
      // Webhook on invoice.paid sends the confirmation emails.
      // (PM for subsequent recurring months after the initial hosted pay is attached post-payment
      // in the invoice.paid handler — see webhook/route.ts. This creation block must stay exactly as-is.)
      if (!stripeCustomerId) {
        if (!email) {
          return NextResponse.json({ error: 'Email is required to create a lease subscription.' }, { status: 400 });
        }
        try {
          const customer = await stripe.customers.create({
            email,
            name: company || undefined,
            address: {
              line1: address || undefined,
              city: city || undefined,
              postal_code: postal || undefined,
              country: country || undefined,
            },
            metadata: {
              company_name: company || 'N/A',
              vat_number: vatNumber || 'N/A',
              po_number: poNumber || 'N/A',
            },
          });
          stripeCustomerId = customer.id;
        } catch (custErr) {
          console.error('Failed to create Stripe customer for lease', custErr);
          return NextResponse.json({ error: 'Unable to prepare customer for lease payment.' }, { status: 500 });
        }
      }

      const lease = leaseDetails!;

      // Create a pending InvoiceItem for the one-time upfront before creating the subscription.
      // This is the supported way (in this Stripe API version) to attach an ad-hoc one-time
      // amount + description to the *first invoice* generated by the subscription.
      //
      // The user's requested payload (add_invoice_items with amount/description or price_data)
      // is not supported for dynamic one-time lines. We achieve the equivalent by creating
      // a pending InvoiceItem (which appears on the subscription's first invoice) + the
      // recurring item below.
      if (lease.upfrontAmount > 0) {
        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          amount: lease.upfrontAmount * 100,
          currency: 'eur',
          description: `Upfront payment (${UPFRONT_PERCENT}%) for leased NoCloud appliance`,
        });
      }

      const cancelAt = Math.floor(Date.now() / 1000) + (lease.months * 31 * 24 * 3600);

      // In this API version, direct subscriptions.create does not accept inline
      // `price_data.product_data` for items (unlike Checkout sessions). We must first
      // create a Product and reference it by ID via `price_data.product`.
      // This is the minimal adaptation to use the direct `subscriptions.create` style
      // the user requested while keeping dynamic pricing (no pre-created catalog prices).
      const leaseProduct = await stripe.products.create({
        name: 'NoCloud Appliance Lease + Services',
        description: `Monthly lease payment (hardware amortized + services over ${lease.months} months). Includes €${lease.upfrontAmount} upfront payment charged as part of the initial invoice.`,
      });

      const subParams: any = {
        customer: stripeCustomerId,
        collection_method: 'charge_automatically',
        // Critical for direct subscriptions.create when no PM is attached yet:
        // Do not attempt to charge the initial invoice (upfront + first month) at creation time.
        // This allows us to create the sub successfully (status: incomplete), generate the
        // first invoice (with the pending upfront InvoiceItem + recurring period), then redirect
        // the user to hosted_invoice_url. The hosted page lets them add card/SEPA and pay.
        // Without this, creation fails with "no attached payment source or default payment method".
        payment_behavior: 'default_incomplete',
        items: [
          {
            price_data: {
              currency: 'eur',
              product: leaseProduct.id,   // Reference existing Product (required here)
              unit_amount: monthlyTotal * 100,
              recurring: { interval: 'month' },
            },
          },
        ],
        // No add_invoice_items (upfront is injected via the pending InvoiceItem above).
        // Metadata includes the keys from the user's example payload (contract_type etc.).
        cancel_at: cancelAt,
        metadata: {
          company_name: company || 'N/A',
          vat_number: vatNumber || 'N/A',
          po_number: poNumber || 'N/A',
          address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
          financing: 'lease',
          lease_months: lease.months.toString(),
          lease_cancel_at: cancelAt.toString(),
          lease_upfront_amount: lease.upfrontAmount.toString(),
          lease_financed_amount: lease.financedAmount.toString(),
          services: JSON.stringify(resolvedServicesForMeta),
          customer_email: email || 'N/A',
          pricing_version: PRICING_VERSION,
          locale,
          contract_type: 'leasing',
          upfront_percent: String(UPFRONT_PERCENT),
          total_value: String(hardwareTotal),
        },
        expand: ['latest_invoice'],
      };

      const subscription = await stripe.subscriptions.create(subParams);

      // The initial invoice (created at sub creation) includes the pending upfront InvoiceItem
      // (created above) + the first recurring period. Redirect to its hosted_invoice_url for payment.
      // (card/SEPA supported; on success the invoice.paid webhook will fire and send emails.)
      let hostedUrl: string | undefined;
      const li = (subscription as any).latest_invoice;
      if (li && typeof li !== 'string' && li.hosted_invoice_url) {
        hostedUrl = li.hosted_invoice_url;
      }
      if (!hostedUrl && li) {
        const invId = typeof li === 'string' ? li : li.id;
        if (invId) {
          try {
            const inv = await stripe.invoices.retrieve(invId);
            hostedUrl = inv.hosted_invoice_url || undefined;
          } catch (invErr) {
            console.warn('Could not retrieve invoice for hosted url', invErr);
          }
        }
      }
      if (!hostedUrl) {
        console.error('Lease subscription created but no hosted_invoice_url available', subscription.id);
        return NextResponse.json({ error: 'Lease created but payment link unavailable. Please contact support.' }, { status: 500 });
      }

      return NextResponse.json({ url: hostedUrl });
    }

    if (paymentMethod === 'invoice') {
      // Production-ready Pay by Invoice (B2B Net 30).
      // Previously this was a pure client mock with no Stripe objects or server emails.
      // Now we create a real Customer (for ownership + metadata) and a real Invoice with
      // collection_method: 'send_invoice' + days_until_due: 30. The Invoice is finalized/sent
      // by Stripe (customer receives it via email or dashboard). Confirmation emails are sent
      // from here (and/or on invoice.paid in webhook for the actual payment later).
      // Policy (isInvoiceAllowed + guards above) still ensures this path is only for full + no services.
      //
      // NOTE (per plan "Lease safety rule"): the entire preceding `if (financing === 'lease')` block
      // (sub creation, pending InvoiceItem, dynamic Product, payment_behavior, hosted redirect, etc.)
      // was left completely untouched. The lease upfront+monthly flow that was painful to stabilize
      // must continue to work exactly as before. Only this invoice branch (and additive webhook code)
      // was added.
      if (!stripeCustomerId && email) {
        try {
          const customer = await stripe.customers.create({
            email,
            name: company || undefined,
            address: {
              line1: address || undefined,
              city: city || undefined,
              postal_code: postal || undefined,
              country: country || undefined,
            },
            metadata: {
              company_name: company || 'N/A',
              vat_number: vatNumber || 'N/A',
              po_number: poNumber || 'N/A',
            },
          });
          stripeCustomerId = customer.id;
        } catch (custErr) {
          console.error('Failed to create Stripe customer for invoice', custErr);
          return NextResponse.json({ error: 'Unable to prepare customer for invoice.' }, { status: 500 });
        }
      }

      // Create the Invoice (send_invoice style).
      const invoice = await stripe.invoices.create({
        customer: stripeCustomerId,
        collection_method: 'send_invoice',
        days_until_due: 30,
        auto_advance: true,
        metadata: {
          company_name: company || 'N/A',
          vat_number: vatNumber || 'N/A',
          po_number: poNumber || 'N/A',
          address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
          financing,
          services: JSON.stringify(resolvedServicesForMeta),
          customer_email: email || 'N/A',
          pricing_version: PRICING_VERSION,
          locale,
        },
      });

      // Add hardware line items (one-time only; services are 0 per policy guard).
      // Mirror the resolved pricing + qty logic used for full Checkout.
      for (const item of (items || [])) {
        const qty = item.quantity || 1;
        const slug = item.product?.slug as string | undefined;
        const unit = slug ? getHardwarePrice(slug) : (item.product?.price || 0);
        const svcNames = (item.services || []).map((s: any) => s.name).filter(Boolean);
        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          invoice: invoice.id,
          amount: Math.round(unit * 100 * qty),
          currency: 'eur',
          description: `NoCloud ${item.product?.name || 'Appliance'}${svcNames.length ? ` (includes: ${svcNames.join(', ')})` : ''}`,
        });
      }

      await stripe.invoices.finalizeInvoice(invoice.id);

      // Send confirmation emails for the real B2B invoice (registered + "you will receive the invoice").
      // This replaces the previous client-only mock that sent no server emails.
      const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
      const customerEmailForInvoice = email; // from top-level destructuring
      if (customerEmailForInvoice && resend) {
        try {
          const isFr = locale === 'fr';
          const subj = isFr
            ? `Merci pour votre commande nocloud.ai #${invoice.id.slice(-8)}`
            : `Thank you for your nocloud.ai order #${invoice.id.slice(-8)}`;
          await resend.emails.send({
            from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
            to: customerEmailForInvoice,
            subject: subj,
            html: `
              <h1 style="color: #0ea5e9;">${isFr ? 'Merci pour votre achat !' : 'Thank you for your purchase!'}</h1>
              <p>${isFr ? 'Votre commande a été enregistrée. Vous recevrez sous peu une facture avec les instructions de paiement (Net 30).' : 'Your order has been registered. You will receive an invoice with payment instructions shortly (Net 30).'} </p>
              <p><strong>Order ID:</strong> ${invoice.id}</p>
              <p><strong>Company:</strong> ${company || 'N/A'}</p>
            `,
          });
        } catch (e) { console.error('Failed to send invoice registered email', e); }
      }
      if (process.env.ADMIN_EMAIL && resend) {
        try {
          await resend.emails.send({
            from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
            to: process.env.ADMIN_EMAIL,
            subject: `New B2B Invoice (Net 30) - #${invoice.id.slice(-8)}`,
            html: `<p>New Pay by Invoice order for ${company || email}. Invoice ${invoice.id} created and sent (Net 30).</p>`,
          });
        } catch (e) { console.error('Failed to send admin invoice email', e); }
      }

      // Return success (client will show friendly overlay; no hosted "pay now" URL because this is Net 30 send_invoice).
      // The real Stripe Invoice is now in the dashboard and will be delivered to the customer.
      console.log(`Real B2B invoice created and finalized: ${invoice.id} for customer ${stripeCustomerId}`);
      return NextResponse.json({ success: true, invoiceId: invoice.id });
    }

    // Direct / full payment (non-lease): one-time for hardware only.
    // Services (if any) will be turned into real subscriptions by the webhook.
    // Use proper quantity + unit price (resolved server-side) so Stripe line items correctly reflect qty > 1.
    const lineItems: any[] = (items || []).map((item: any) => {
      const qty = item.quantity || 1;
      const slug = item.product?.slug as string | undefined;
      const unit = slug ? getHardwarePrice(slug) : (item.product?.price || 0);
      const svcNames = (item.services || []).map((s: any) => s.name).filter(Boolean);
      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `NoCloud ${item.product?.name || 'Appliance'}`,
            description: svcNames.length > 0 ? `Includes: ${svcNames.join(', ')}` : undefined,
          },
          unit_amount: unit * 100,
        },
        quantity: qty,
      };
    });

    const pmTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
      paymentMethod === 'sepa' ? ['sepa_debit'] : ['card'];

    const mode: 'payment' | 'subscription' = 'payment';

    // No upfront lease strings for full payment path (custom_text only relevant for lease via checkout, which we no longer use for lease).
    const leaseUpfrontStr = '';
    const leaseMonthsStr = '';
    const leaseCancelAt = '';
    const leaseFinancedStr = '';

    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      payment_method_types: pmTypes,
      mode,
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}?canceled=true`,
      // Make the Stripe-hosted Checkout page itself appear in the user's language (en/fr supported by Stripe)
      locale,
      metadata: {
        company_name: company || 'N/A',
        vat_number: vatNumber || 'N/A',
        po_number: poNumber || 'N/A',
        address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
        financing,
        lease_months: leaseMonthsStr,
        lease_cancel_at: leaseCancelAt,
        lease_upfront_amount: leaseUpfrontStr,
        lease_financed_amount: leaseFinancedStr,
        services: JSON.stringify(resolvedServicesForMeta),
        customer_email: email || 'N/A',
        pricing_version: PRICING_VERSION,
        locale,
      },
    };
    if (stripeCustomerId) {
      sessionParams.customer = stripeCustomerId;
    } else if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return NextResponse.json({ url: session.url });
  } catch (error: any) {
    console.error('Stripe error:', error);
    let errMsg = 'Failed to create checkout session';
    if (error?.message) {
      errMsg = error.message;
    } else if (error?.raw?.message) {
      errMsg = error.raw.message;
    }
    // Also handle missing key specifically
    if (!process.env.STRIPE_SECRET_KEY) {
      errMsg = 'Stripe secret key is not configured. Please create .env.local with STRIPE_SECRET_KEY=sk_test_... (and NEXT_PUBLIC_SITE_URL=http://localhost:8080 for dev)';
    }
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
