import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { Resend } from 'resend';
import { calculateLease, isOverSepaLimit, isPbiAllowed, isInvoiceAllowed, LEASE_MIN, LEASE_MAX, PBI_MIN, PBI_MAX, PRICING_VERSION, getHardwarePrice, getServicePrice, ServiceKey, UPFRONT_PERCENT, DEBUG_PAYMENTS } from '@/lib/pricing';

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

    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] checkout received payload', {
        financing,
        paymentMethod,
        itemsCount: (items || []).length,
        servicesInItems: (items || []).reduce((n: number, it: any) => n + ((it.services || []).length || 0), 0),
        resolvedServicesForMetaLen: resolvedServicesForMeta.length,
        resolvedServicesForMeta,
        hardwareTotal,
        servicesMonthly,
      });
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
        error: 'Pay by Invoice is only available for full payments (services supported via recurring invoices) or within ranges.'
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
      if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] routing -> LEASE branch');
      // Lease: upfront (or full hardware upfront %) charged as the *initial* payment (due today).
      // The recurring monthly lease payments (hardware amortized + services) only start ~1 month later.
      // We create the subscription with trial_end so the first paid monthly invoice comes after the trial.
      // The initial payment is handled separately (Checkout for card/sepa, send_invoice for pay-by-invoice).
      // This satisfies "recurring starts one month after initial payment" for lease mode.
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

      // Small polish to cancelAt (calendar months via setMonth) for cleaner "end of term" behavior.
      const cancelDate = new Date();
      cancelDate.setMonth(cancelDate.getMonth() + lease.months);
      const cancelAt = Math.floor(cancelDate.getTime() / 1000);

      // Upfront (initial payment due today) is handled separately.
      // For pay-by-invoice: only create the upfront send_invoice now.
      // The recurring sub (with trial so monthly starts ~1 month after the actual payment of this invoice) 
      // will be created later in the webhook on invoice.paid. This avoids creating an immediate €0 
      // trial draft invoice from the sub at registration time (the source of the "buggy" list).
      if (paymentMethod === 'invoice') {
        const upfrontInvoice = await stripe.invoices.create({
          customer: stripeCustomerId,
          collection_method: 'send_invoice',
          days_until_due: 30,
          auto_advance: true,
          metadata: {
            company_name: company || 'N/A',
            vat_number: vatNumber || 'N/A',
            po_number: poNumber || 'N/A',
            address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
            financing: 'lease',
            is_upfront_only: 'true',
            lease_upfront_amount: lease.upfrontAmount.toString(),
            lease_monthly_amount: monthlyTotal.toString(),
            lease_months: lease.months.toString(),
            lease_cancel_at: cancelAt.toString(),
            lease_financed_amount: lease.financedAmount.toString(),
            services: JSON.stringify(resolvedServicesForMeta),
            customer_email: email || 'N/A',
            pricing_version: PRICING_VERSION,
            locale,
            contract_type: 'leasing',
            upfront_percent: String(UPFRONT_PERCENT),
            total_value: String(hardwareTotal),
            recurring_starts_one_month_after_payment: 'true',
          },
        });

        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          invoice: upfrontInvoice.id,
          amount: lease.upfrontAmount * 100,
          currency: 'eur',
          description: `Upfront payment (${UPFRONT_PERCENT}%) for leased NoCloud appliance`,
        });

        await stripe.invoices.finalizeInvoice(upfrontInvoice.id);

        // Registered emails for the upfront B2B invoice. Note that the subscription will be created on payment,
        // with recurring starting ~1 month after this invoice is paid.
        const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
        const customerEmailForInvoice = email;
        if (customerEmailForInvoice && resend) {
          try {
            const isFr = locale === 'fr';
            const subj = isFr
              ? `Merci pour votre commande nocloud.ai #${upfrontInvoice.id.slice(-8)} (acompte leasing)`
              : `Thank you for your nocloud.ai order #${upfrontInvoice.id.slice(-8)} (lease upfront)`;
            await resend.emails.send({
              from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
              to: customerEmailForInvoice,
              subject: subj,
              html: `
                <h1 style="color: #0ea5e9;">${isFr ? 'Merci pour votre achat !' : 'Thank you for your purchase!'}</h1>
                <p>${isFr ? 'Votre acompte leasing a été enregistré (Net 30). Le contrat de location (paiements mensuels récurrents) sera activé au paiement de cette facture ; les paiements récurrents commenceront dans environ 1 mois après le paiement.' : 'Your lease upfront has been registered (Net 30). The lease subscription (recurring monthly payments) will be activated upon payment of this invoice; recurring payments will begin approximately 1 month after payment.'}</p>
                <p><strong>Invoice:</strong> ${upfrontInvoice.id}</p>
                <p><strong>Company:</strong> ${company || 'N/A'}</p>
              `,
            });
          } catch (e) { console.error('Failed to send lease upfront registered email', e); }
        }
        if (process.env.ADMIN_EMAIL && resend) {
          try {
            await resend.emails.send({
              from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
              to: process.env.ADMIN_EMAIL,
              subject: `New Lease Upfront (Net 30) - #${upfrontInvoice.id.slice(-8)}`,
              html: `<p>New lease upfront invoice for ${company || email}. Invoice ${upfrontInvoice.id}. Recurring sub will be created on payment (monthly starts ~1 month after payment).</p>`,
            });
          } catch (e) { console.error('Failed to send admin lease upfront email', e); }
        }

        console.log(`Lease upfront invoice created: ${upfrontInvoice.id} (recurring sub will be created on payment)`);
        return NextResponse.json({ success: true, invoiceId: upfrontInvoice.id });
      } else {
        // Card or sepa: create the sub with trial_end now (payment is immediate), then one-time Checkout for the upfront.
        const trialEnd = Math.floor(Date.now() / 1000) + 32 * 24 * 3600;

        const leaseProduct = await stripe.products.create({
          name: 'NoCloud Appliance Lease (hardware)',
          description: `Monthly lease payments for hardware amortization over ${lease.months} months (upfront paid separately; recurring starts ~1 month after initial payment). Optional services are on separate perpetual subscriptions.`,
        });

        const subParams: any = {
          customer: stripeCustomerId,
          collection_method: 'charge_automatically',
          items: [
            {
              price_data: {
                currency: 'eur',
                product: leaseProduct.id,
                unit_amount: lease.hardwarePerMonth * 100,
                recurring: { interval: 'month' },
              },
            },
          ],
          trial_end: trialEnd,
          cancel_at: cancelAt,
          payment_behavior: 'default_incomplete',
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
            trial_end: trialEnd.toString(),
            recurring_starts_one_month_after_initial: 'true',
            upfront_charged_separately: 'true',
          },
          expand: ['latest_invoice'],
        };

        const subscription = await stripe.subscriptions.create(subParams);
        const leaseSubId = subscription.id;

        if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] lease: pre-creating', resolvedServicesForMeta.length, 'service subs (for card/sepa lease)');
        // Pre-create the perpetual service subs early (like the lease hardware sub), in trialing with default_incomplete.
        // They will get the default PM attached in the webhook after the upfront payment.
        // This ensures the user sees the service subs immediately after placing the lease order.
        let leaseServiceSubIds: string[] = [];
        for (const s of resolvedServicesForMeta) {
          try {
            const serviceProduct = await stripe.products.create({ name: s.name });
            const trialEnd = Math.floor(Date.now() / 1000) + 32 * 24 * 3600;
            const subParams2: any = {
              customer: stripeCustomerId,
              collection_method: 'charge_automatically',
              trial_end: trialEnd,
              payment_behavior: 'default_incomplete',
              items: [{
                price_data: {
                  currency: 'eur',
                  product: serviceProduct.id,
                  unit_amount: Math.round(s.price * 100),
                  recurring: { interval: 'month' },
                },
              }],
              metadata: {
                service: s.name,
                is_lease_service: 'true',
              },
            };
            const svcSub = await stripe.subscriptions.create(subParams2);
            leaseServiceSubIds.push(svcSub.id);
            console.log(`Pre-created lease service sub ${svcSub.id} for "${s.name}" (will attach PM after upfront payment; visible immediately in trialing)`);
          } catch (e) {
            console.error('Failed to pre-create lease service sub in route', e);
          }
        }

        // Card or sepa: one-time Checkout for the upfront amount only.
        const pmTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
          paymentMethod === 'sepa' ? ['sepa_debit'] : ['card'];

        const upfrontSession = await stripe.checkout.sessions.create({
          payment_method_types: pmTypes,
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'eur',
              product_data: {
                name: `NoCloud Appliance Lease Upfront (${UPFRONT_PERCENT}%)`,
                description: `Due today. Recurring monthly lease payments start in approximately 1 month.`,
              },
              unit_amount: lease.upfrontAmount * 100,
            },
            quantity: 1,
          }],
          customer: stripeCustomerId,
          success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}?canceled=true`,
          locale,
          metadata: {
            company_name: company || 'N/A',
            vat_number: vatNumber || 'N/A',
            po_number: poNumber || 'N/A',
            address: JSON.stringify({ address: address || '', city: city || '', postal: postal || '', country: country || '' }),
            financing: 'lease',
            is_lease_upfront: 'true',
            lease_subscription_id: leaseSubId,
            lease_service_sub_ids: JSON.stringify(leaseServiceSubIds),
            lease_months: lease.months.toString(),
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
          payment_intent_data: {
            setup_future_usage: 'off_session',
          },
        });

        return NextResponse.json({ url: upfrontSession.url });
      }
    }

    if (paymentMethod === 'invoice') {
      if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] routing -> INVOICE branch');
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

      // Add hardware line items (one-time). Services first periods are added as additional lines below
      // (combined on the same net30 invoice for the order). Mirror resolved pricing + qty.
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

      // Recurring services for pay-by-invoice (full + services now supported; lease+invoice still disallowed in UI).
      // The initial net30 invoice contains hardware only.
      // Best-effort create real send_invoice Subscriptions using a trial_end (~1 month) so that the
      // first paid recurring service invoices are generated ~1 month after the initial payment.
      // After creation we update the auto-generated €0 trial invoice (if present) with a clear description
      // pointing back to the main order invoice.
      // Pattern reuses the dynamic Product + price_data from the webhook full services path.
      for (const s of resolvedServicesForMeta) {
        // Best effort: set up the recurring subscription (trial so recurring starts 1 month after initial).
        try {
          const serviceProduct = await stripe.products.create({ name: s.name });
          const trialEnd = Math.floor(Date.now() / 1000) + 32 * 24 * 3600; // ~1 month out
          const sub = await stripe.subscriptions.create({
            customer: stripeCustomerId,
            collection_method: 'send_invoice',
            days_until_due: 30,
            trial_end: trialEnd,
            items: [{
              price_data: {
                currency: 'eur',
                product: serviceProduct.id,
                unit_amount: Math.round(s.price * 100),
                recurring: { interval: 'month' },
              } as any,
            }],
            metadata: {
              order_invoice: invoice.id,
              service: s.name,
              pricing_version: PRICING_VERSION,
            },
            expand: ['latest_invoice'],
          });

          // Stripe creates a €0 draft "trial period" invoice for the trial. Update it with an explanation
          // so it is not confusing. No service amount is on the main hardware net30; the first paid
          // recurring will come from the sub after the trial.
          const latestInv = (sub as any).latest_invoice;
          if (latestInv) {
            const invId = typeof latestInv === 'string' ? latestInv : latestInv.id;
            if (invId) {
              try {
                const inv = typeof latestInv === 'string' || !latestInv.status
                  ? await stripe.invoices.retrieve(invId)
                  : latestInv;
                if (inv.status === 'draft' || inv.status === 'open') {
                  await stripe.invoices.update(invId, {
                    description: `Trial period for ${s.name}. Recurring monthly service payments will start after this trial (approximately 1 month after the order). See main order invoice ${invoice.id}.`,
                    footer: 'Recurring services begin ~1 month after initial hardware payment.',
                  });
                  console.log(`Updated trial invoice ${invId} for service sub "${s.name}"`);
                }
              } catch (updErr) {
                console.warn('Could not update trial invoice for service sub', updErr);
              }
            }
          }

          console.log(`Created send_invoice service sub (trial) for "${s.name}" on invoice ${invoice.id}`);
        } catch (subErr) {
          console.error('Failed to setup recurring service sub for pay-by-invoice', subErr);
        }
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
    if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] routing -> FULL (non-lease) branch');
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
      // Ensure the collected PM is saved for future off-session use (recurring service subs).
      payment_intent_data: {
        setup_future_usage: 'off_session',
      },
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
    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] full session metadata.services =', JSON.stringify(resolvedServicesForMeta));
    }
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
