import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ 
      error: 'Stripe secret key is not configured. Please create .env.local with STRIPE_SECRET_KEY=sk_test_... and NEXT_PUBLIC_SITE_URL=http://localhost:8080' 
    }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2025-02-24.acacia',
  });

  try {
    const body = await request.json();
    const {
      items,
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

    if (financing === 'lease') {
      mode = 'subscription';
      const months = hardwareTotal < 10000 ? 12 : 24;
      const hardwarePerMonth = Math.ceil(hardwareTotal / months);
      const monthlyTotal = hardwarePerMonth + servicesMonthly;

      lineItems = [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'NoCloud Appliance Lease + Services',
              description: `Financed over ${months} months (hardware amortized + services)`,
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
      const cancelAt = Math.floor(Date.now() / 1000) + (months * 31 * 24 * 3600);
      leaseCancelAt = cancelAt.toString();
      leaseMonthsStr = months.toString();
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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: pmTypes,
      mode,
      line_items: lineItems,
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}`,
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
