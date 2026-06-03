import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { calculateLease, isOverSepaLimit, PRICING_VERSION } from '@/lib/pricing';

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

    // Authoritative totals from raw item data (client totalPrice is only hardware)
    const hardwareTotal = (items || []).reduce((sum: number, item: any) => {
      const qty = item.quantity || 1;
      return sum + ((item.product?.price || 0) * qty);
    }, 0);

    const servicesMonthly = (items || []).reduce((sum: number, item: any) => {
      const svcs = item.services || [];
      const qty = item.quantity || 1;
      return sum + svcs.reduce((s: number, p: any) => s + (p.price || 0) * qty, 0);
    }, 0);

    let mode: 'payment' | 'subscription' = 'payment';
    let lineItems: any[] = [];
    let leaseCancelAt = '';
    let leaseMonthsStr = '';
    let monthlyTotal = 0;

    if (financing === 'lease') {
      mode = 'subscription';
      const lease = calculateLease(hardwareTotal, servicesMonthly);
      monthlyTotal = lease.monthlyTotal;

      lineItems = [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'NoCloud Appliance Lease + Services',
              description: `Financed over ${lease.months} months (hardware amortized + services)`,
            },
            unit_amount: monthlyTotal * 100,
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ];

      // Compute cancel_at timestamp and pass ONLY via metadata.
      // subscription_data.cancel_at is not supported on Checkout session create
      // (even in recent API versions) -- we'll apply it via subscriptions.update
      // in the webhook.
      const cancelAt = Math.floor(Date.now() / 1000) + (lease.months * 31 * 24 * 3600);
      leaseCancelAt = cancelAt.toString();
      leaseMonthsStr = lease.months.toString();
    } else {
      // Direct / full payment: one-time for hardware only.
      // Services (if any) will be turned into real subscriptions by the webhook.
      // Use proper quantity + unit price so Stripe line items correctly reflect qty > 1.
      lineItems = (items || []).map((item: any) => ({
        price_data: {
          currency: 'eur',
          product_data: {
            name: `NoCloud ${item.product?.name || 'Appliance'}`,
            description: (item.services || []).length > 0
              ? `Includes: ${(item.services || []).map((s: any) => s.name).join(', ')}`
              : undefined,
          },
          unit_amount: (item.product?.price || 0) * 100,
        },
        quantity: item.quantity || 1,
      }));
    }

    const pmTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = 
      paymentMethod === 'sepa' ? ['sepa_debit'] : ['card'];

    // Guard against Stripe limits: SEPA Direct Debit (and some other PMs) cap the charge amount at €10,000.
    // For "full" this is the one-time total; for "lease" it's the monthly recurring charge.
    // Logic centralized in pricing.ts (client + server must agree).
    const dueAmount = financing === 'lease' ? monthlyTotal : hardwareTotal;
    if (paymentMethod === 'sepa' && isOverSepaLimit(dueAmount)) {
      return NextResponse.json({
        error: `SEPA Direct Debit payments are limited to €10,000. Your ${financing === 'lease' ? 'monthly lease payment' : 'order total'} is €${dueAmount}. Please select "Credit / Debit card" (or reduce quantity / use Pay in full for smaller hardware totals).`
      }, { status: 400 });
    }

    // Email is collected in our form (kept) and transmitted here.
    // We explicitly create a Stripe Customer (with email + rich B2B metadata) so we "own"
    // the customer record in Stripe (durable, queryable, has our metadata attached) rather than
    // only having ephemeral session data. This is key to not being fully locked into the provider.
    let stripeCustomerId: string | undefined;
    if (email) {
      try {
        const customer = await stripe.customers.create({
          email,
          name: company || undefined,
          metadata: {
            company_name: company || 'N/A',
            vat_number: vatNumber || 'N/A',
            po_number: poNumber || 'N/A',
            address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
          },
        });
        stripeCustomerId = customer.id;
      } catch (custErr) {
        console.warn('Failed to pre-create Stripe customer (Checkout will create one); proceeding anyway', custErr);
      }
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: pmTypes,
      mode,
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}`,
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      customer_email: email || undefined,
      metadata: {
        company_name: company || 'N/A',
        vat_number: vatNumber || 'N/A',
        po_number: poNumber || 'N/A',
        address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
        financing,
        lease_months: leaseMonthsStr,
        lease_cancel_at: leaseCancelAt,
        services: JSON.stringify(
          (items || []).flatMap((i: any) => {
            const qty = i.quantity || 1;
            return (i.services || []).map((s: any) => ({ name: s.name, price: s.price * qty }));
          })
        ),
        customer_email: email || 'N/A',
        pricing_version: PRICING_VERSION,
      },
    });

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
