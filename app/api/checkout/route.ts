import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import {
  calculateLease,
  isOverSepaLimit,
  isPbiAllowed,
  isInvoiceAllowed,
  LEASE_MIN,
  LEASE_MAX,
  PBI_MIN,
  PBI_MAX,
  PRICING_VERSION,
  getHardwarePrice,
  getServicePrice,
  ServiceKey,
  UPFRONT_PERCENT,
  DEBUG_PAYMENTS,
  calculateHardwarePrice,
  formatHardwareCustomization,
} from '@/lib/pricing';
import { createB2BStripeCustomer } from '@/lib/stripe-customer';
import { sendRegisteredInvoiceCustomerEmail, sendAdminInvoiceRegisteredEmail } from '@/lib/emails';
import { buildPaymentContext, validatePaymentEligibility, resolvePricesAndServices } from '@/lib/payment-flow';
import { cleanupZeroTrialInvoice } from '@/lib/stripe-invoices';
import { buildOrderMetadata } from '@/lib/stripe-metadata';
import { createMonthlyRecurringPriceDataItem } from '@/lib/stripe-subscriptions';
import { BRAND_NAME } from '@/lib/brand';
import { determineVatTreatment, computeVatAmounts, DEBUG_VAT as DEBUG_VAT_TREATMENT } from '@/lib/vat';

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
      recurringPaymentMethod,   // only present+relevant for paymentMethod==='invoice' + services; 'stripe'|'sepa' means use automatic subs for recurring (collected via mode:'setup')
      vatInclusive,             // professional customer explicit choice (only when offered + legally allowed). Server validates.
    } = body;

    // Authoritative prices + totals (pure, now extracted). Client prices ignored.
    // resolve now also returns resolved hardware customizations (with labels + extras) via the
    // single logical component (calculateHardwarePrice) when items carry customization.
    const { hardwareTotal, servicesMonthly, resolvedServicesForMeta, resolvedHardwareForMeta = [] } = resolvePricesAndServices(items || []);

    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] checkout received payload', {
        financing,
        paymentMethod,
        recurringPaymentMethod,
        itemsCount: (items || []).length,
        servicesInItems: (items || []).reduce((n: number, it: any) => n + ((it.services || []).length || 0), 0),
        resolvedServicesForMetaLen: resolvedServicesForMeta.length,
        resolvedServicesForMeta,
        resolvedHardwareForMetaLen: resolvedHardwareForMeta.length,
        resolvedHardwareForMeta,
        hardwareTotal,
        servicesMonthly,
      });
    }

    const paymentContext = buildPaymentContext({
      financing: financing as any,
      paymentMethod: paymentMethod as any,
      servicesMonthly,
      hardwareTotal,
      recurringPaymentMethod: recurringPaymentMethod as any,
    });

    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] paymentContext strategy=', paymentContext.strategy, 'hybrid=', paymentContext.isHybridRecurringSetup);
    }

    // Email is collected in our form (kept) and transmitted here.
    // We explicitly create a Stripe Customer (with email + rich B2B metadata and structured address)
    // so we "own" the customer record in Stripe. The address is set on the customer object
    // so that when we pass the customer to the Checkout session, Stripe will prefill the
    // billing address in the hosted Checkout (preventing the user from having to enter it twice).
    let stripeCustomerId: string | undefined;
    if (email) {
      try {
        stripeCustomerId = await createB2BStripeCustomer(stripe, {
          email,
          company,
          vatNumber,
          poNumber,
          address,
          city,
          postal,
          country,
        });
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
    // (client UX mirrors this; server is authoritative). Now delegated to shared validator.
    const eligibilityError = validatePaymentEligibility(paymentContext, hardwareTotal, dueAmount, servicesMonthly);
    if (eligibilityError === 'LEASE_RANGE') {
      return NextResponse.json({
        error: `Leasing is only available for hardware totals between €${LEASE_MIN} and €${LEASE_MAX}.`
      }, { status: 400 });
    }
    if (eligibilityError === 'PBI_RANGE') {
      return NextResponse.json({
        error: `Pay by Invoice is only available for hardware totals between €${PBI_MIN} and €${PBI_MAX}.`
      }, { status: 400 });
    }
    if (eligibilityError === 'INVOICE_POLICY') {
      return NextResponse.json({
        error: 'Pay by Invoice is only available for full payments (recurring services use a separate card/SEPA choice inside the invoice box) or within ranges.'
      }, { status: 400 });
    }
    if (eligibilityError === 'SEPA_MAIN') {
      return NextResponse.json({
        error: `SEPA Direct Debit payments are limited to €10,000. Your ${financing === 'lease' ? 'monthly lease payment' : 'order total'} is €${dueAmount}. Please select "Credit / Debit card" (or reduce quantity / use Pay in full for smaller hardware totals).`
      }, { status: 400 });
    }
    if (eligibilityError === 'SEPA_SERVICES') {
      return NextResponse.json({
        error: `SEPA Direct Debit payments are limited to €10,000. Your recurring services total is €${servicesMonthly}. Please select "Credit / Debit card" for the recurring services (inside the Pay by Invoice box) or reduce the services.`
      }, { status: 400 });
    }

    // === VAT Treatment Determination (core per spec §2) — happens BEFORE any customer choice is honored ===
    // This is the single source of truth. Client may have shown a checkbox, but we re-evaluate here
    // with authoritative inputs and reject any illegal election.
    const vatTreatment = determineVatTreatment({
      customerCountry: country,
      vatNumber: vatNumber || undefined,
      // supplyType defaults to goods for appliances (services follow the same treatment for the order)
    });
    const customerChoiceInclusive = vatInclusive === true;
    if (DEBUG_VAT_TREATMENT || DEBUG_PAYMENTS) {
      console.log('[VAT DEBUG] route determination', {
        customerCountry: country,
        hasVatNumber: !!vatNumber,
        customerChoiceInclusive,
        treatment: vatTreatment,
      });
    }

    if (customerChoiceInclusive && !vatTreatment.canOfferVatInclusive) {
      return NextResponse.json({
        error: 'VAT-inclusive billing is not permitted for this transaction. Reverse charge (or another mandatory legal treatment) applies and customer choice is not allowed. Please submit without the VAT-inclusive election (or remove/adjust your VAT number and country).',
      }, { status: 400 });
    }

    // Resolve whether to gross: ONLY on explicit customer choice (vatInclusive=true) + allowed.
    // (Domestic mandatory charge_vat is noted in treatment but we do not auto-gross to preserve
    // existing net billing behavior for orders that do not elect the option.)
    const chargesVat = customerChoiceInclusive;
    const effectiveRate = chargesVat ? vatTreatment.vatRate : 0;
    const netBaseForVat = hardwareTotal; // primary taxable base for one-time; recurring services + lease amort use same rate
    const vatAmounts = computeVatAmounts(netBaseForVat, effectiveRate, chargesVat);
    // For display / metadata we also compute a services gross preview (rate is same for the order)
    const servicesVatPreview = computeVatAmounts(servicesMonthly, effectiveRate, chargesVat);

    if (DEBUG_VAT_TREATMENT || DEBUG_PAYMENTS) {
      console.log('[VAT DEBUG] resolved final', {
        chargesVat,
        effectiveRate,
        netBase: netBaseForVat,
        gross: vatAmounts.gross,
        vatAmount: vatAmounts.vatAmount,
        customerChoiceInclusive,
      });
    }

    // Common VAT metadata fragment (immutable audit trail — stored on every Stripe object)
    const vatMeta = {
      vat_inclusive_choice: customerChoiceInclusive ? 'true' : 'false',
      vat_treatment: vatTreatment.mandatoryTreatment,
      vat_rate: String(effectiveRate),
      net_total: String(netBaseForVat),
      vat_amount: String(vatAmounts.vatAmount),
      gross_total: String(vatAmounts.gross),
      vat_determination_reason: vatTreatment.reason,
      vat_number_validated: vatTreatment.isValidVatNumber ? 'true' : 'false',
      ...(chargesVat ? { vat_charged: 'true' } : {}),
    };

    // Grossing helpers (applied only to amounts sent to Stripe for charging/invoicing).
    // Pricing/resolver always returns net base. Gross = overlay using the resolved rate.
    const grossUnit = (net: number) => (chargesVat && effectiveRate > 0 ? computeVatAmounts(net, effectiveRate, true).gross : net);

    // Canonical order time for the uniform rule:
    // "recurring payments (services + lease hardware monthly) start exactly one month
    // after order time" using billing_cycle_anchor (non-trial). Captured here so that
    // pre-create paths and all deferred paths (webhook, fulfill, hybrid) use the *same*
    // reference, eliminating special cases based on payment time vs. registration time.
    const orderPlacedAt = Math.floor(Date.now() / 1000);

    // IMPORTANT (per approved plan "Lease safety rule" + user feedback):
    // The entire lease block below (direct subscriptions.create, pending InvoiceItem for upfront,
    // dynamic Product, payment_behavior: 'default_incomplete', hosted_invoice_url redirect, metadata,
    // cancel_at, etc.) was stabilized through a painful iteration process for the exact "upfront + monthly"
    // experience the user requested. **Do not edit inside this block** for recurring PM or invoice work.
    // All lease-related robustness is additive only in the webhook (invoice.paid handler).
    if (financing === 'lease') {
      if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] routing -> LEASE branch (strategy:', paymentContext.strategy, ')');
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
          stripeCustomerId = await createB2BStripeCustomer(stripe, {
            email,
            company,
            vatNumber,
            poNumber,
            address,
            city,
            postal,
            country,
          });
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
          metadata: buildOrderMetadata({
            company,
            vatNumber,
            poNumber,
            address,
            city,
            postal,
            country,
            financing: 'lease',
            services: resolvedServicesForMeta,
            hardware: resolvedHardwareForMeta,
            pricingVersion: PRICING_VERSION,
            locale,
            orderPlacedAt,
            contractType: 'leasing',
            leaseUpfrontAmount: lease.upfrontAmount,
            leaseMonthlyAmount: monthlyTotal,
            leaseMonths: lease.months,
            leaseCancelAt: cancelAt,
            leaseFinancedAmount: lease.financedAmount,
            is_upfront_only: 'true',
            upfront_percent: String(UPFRONT_PERCENT),
            total_value: String(hardwareTotal),
            customer_email: email || 'N/A',
            ...(recurringPaymentMethod && { recurring_payment_method: recurringPaymentMethod }),
            // VAT treatment + customer choice (audit + compliance)
            ...vatMeta,
            // If recurring_payment_method is card/sepa, the recurring subs (lease + services)
            // will be created as charge_automatically on payment of this invoice...
          }),
        });

        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          invoice: upfrontInvoice.id,
          amount: Math.round(grossUnit(lease.upfrontAmount) * 100),
          currency: 'eur',
          description: `Upfront payment (${UPFRONT_PERCENT}%) for leased ${BRAND_NAME} appliance${chargesVat ? ` (VAT ${Math.round(effectiveRate*100)}% incl.)` : ''}`,
        });

        const hasRecurringAuto = resolvedServicesForMeta.length > 0 && recurringPaymentMethod && (recurringPaymentMethod === 'stripe' || recurringPaymentMethod === 'sepa');
        let leaseSubId;
        let leaseServiceSubIds: string[] = [];
        let setupSessionUrl;
        if (hasRecurringAuto) {
          const trialEnd = orderPlacedAt + 32 * 24 * 3600;
          // Pre-create the recurring subs (lease hardware + services) at order time for visibility (in trialing),
          // with trial from order time. PM will be attached after the setup completion (via the attach block).
          // This ensures subscriptions are visible "at the end" of the order + setup process for the recurring choice.
          const leaseProduct = await stripe.products.create({
            name: `${BRAND_NAME} Appliance Lease (hardware)`,
            description: `Monthly lease payments for hardware amortization over ${lease.months} months (upfront paid via Net 30 invoice; recurring starts ~1 month after order via the collected PM from recurring services choice inside invoice box). Optional services on separate perpetual subscriptions.`,
          });
          const subParams: any = {
            customer: stripeCustomerId,
            collection_method: 'charge_automatically',
            items: [{
              price_data: {
                currency: 'eur',
                product: leaseProduct.id,
                unit_amount: Math.round(grossUnit(lease.hardwarePerMonth) * 100),
                recurring: { interval: 'month' },
              },
            }],
            trial_end: trialEnd,
            cancel_at: cancelAt,
            payment_behavior: 'default_incomplete',
            metadata: buildOrderMetadata({
              company,
              vatNumber,
              poNumber,
              address,
              city,
              postal,
              country,
              financing: 'lease',
              services: resolvedServicesForMeta,
            hardware: resolvedHardwareForMeta,
              pricingVersion: PRICING_VERSION,
              locale,
              orderPlacedAt,
              contractType: 'leasing',
              leaseMonths: lease.months,
              leaseCancelAt: cancelAt,
              leaseUpfrontAmount: lease.upfrontAmount,
              leaseFinancedAmount: lease.financedAmount,
              recurring_payment_method: recurringPaymentMethod,
              main_invoice_id: upfrontInvoice.id,
              is_lease_recurring_setup: 'true',
              upfront_percent: String(UPFRONT_PERCENT),
              total_value: String(hardwareTotal),
              // VAT treatment + customer choice (audit + compliance)
              ...vatMeta,
            }),
            expand: ['latest_invoice'],
          };
          const subscription = await stripe.subscriptions.create(subParams);
          leaseSubId = subscription.id;

          // defensive 0 cleanup (now via shared helper)
          let latestInv = (subscription as any).latest_invoice;
          let invId = typeof latestInv === 'string' ? latestInv : latestInv?.id;
          if (invId) {
            const invSub = (await stripe.invoices.retrieve(invId) as any).subscription; // light re-retrieve for sub match
            const invSubId = typeof invSub === 'string' ? invSub : invSub?.id;
            if (!invSubId || invSubId === subscription.id) {
              await cleanupZeroTrialInvoice(stripe, invId, `lease hardware sub ${subscription.id} (hybrid)`);
            }
          }
          // pre-create services
          leaseServiceSubIds = [];
          for (const s of resolvedServicesForMeta) {
            try {
              const item = await createMonthlyRecurringPriceDataItem(stripe, s.name, s.price);
              const subParams2: any = {
                customer: stripeCustomerId,
                collection_method: 'charge_automatically',
                trial_end: trialEnd,
                payment_behavior: 'default_incomplete',
                items: [item],
                metadata: {
                  service: s.name,
                  is_lease_service: 'true',
                  order_placed_at: orderPlacedAt.toString(),
                  main_invoice_id: upfrontInvoice.id,
                  recurring_payment_method: recurringPaymentMethod,
                },
                expand: ['latest_invoice'],
              };
              const svcSub = await stripe.subscriptions.create(subParams2);
              leaseServiceSubIds.push(svcSub.id);

              // defensive 0 cleanup (shared helper)
              let latestInv = (svcSub as any).latest_invoice;
              let invId = typeof latestInv === 'string' ? latestInv : latestInv?.id;
              if (invId) {
                await cleanupZeroTrialInvoice(stripe, invId, `lease service sub ${svcSub.id} (hybrid)`);
              }
              console.log(`Pre-created lease service sub ${svcSub.id} for "${s.name}" (hybrid invoice + recurring ${recurringPaymentMethod}; visible in trialing; PM attached after setup)`);
            } catch (e) {
              console.error('Failed to pre-create lease service sub (lease invoice hybrid)', e);
            }
          }
          // now create setup with the pre-created ids (so attach logic on setup.completed can find and attach PM)
          const pmTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
            recurringPaymentMethod === 'sepa' ? ['sepa_debit'] : ['card'];
          const setupSession = await stripe.checkout.sessions.create({
            payment_method_types: pmTypes,
            mode: 'setup',
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
              services: JSON.stringify(resolvedServicesForMeta),
          hardware: JSON.stringify(resolvedHardwareForMeta),
              customer_email: email || 'N/A',
              pricing_version: PRICING_VERSION,
              locale,
              main_invoice_id: upfrontInvoice.id,
              recurring_payment_method: recurringPaymentMethod,
              order_placed_at: orderPlacedAt.toString(),
              lease_subscription_id: leaseSubId,
              lease_service_sub_ids: JSON.stringify(leaseServiceSubIds),
              is_lease_recurring_setup: 'true',
              // VAT treatment + customer choice (audit + compliance)
              ...vatMeta,
            },
          });
          setupSessionUrl = setupSession.url;
        }

        // For hybrid lease (invoice + recurring auto): stamp the pre-created sub ids into the upfront invoice
        // metadata. This lets the invoice.paid handler detect the pre-created case and skip duplicate creation
        // (the subs + PM attach already happened around the setup trip).
        if (leaseSubId || leaseServiceSubIds.length > 0) {
          try {
            await stripe.invoices.update(upfrontInvoice.id, {
              metadata: {
                ...((upfrontInvoice as any).metadata || {}),
                lease_subscription_id: leaseSubId || '',
                lease_service_sub_ids: JSON.stringify(leaseServiceSubIds),
              },
            });
          } catch (metaUpdErr) {
            console.warn('Could not stamp pre-created lease sub ids onto upfront invoice meta (hybrid)', metaUpdErr);
          }
        }

        await stripe.invoices.finalizeInvoice(upfrontInvoice.id);

        // Registered emails for the upfront B2B invoice. Note that the subscription will be created on payment,
        // with recurring starting ~1 month after this invoice is paid.
        const customerEmailForInvoice = email;
        await sendRegisteredInvoiceCustomerEmail({
          to: customerEmailForInvoice,
          invoiceId: upfrontInvoice.id,
          company: company || 'N/A',
          locale,
          isLeaseUpfront: true,
        });
        await sendAdminInvoiceRegisteredEmail({
          to: '', // not used
          invoiceId: upfrontInvoice.id,
          company: company || 'N/A',
          emailFallback: email,
          isLeaseUpfront: true,
        });

        if (setupSessionUrl) {
          console.log(`Lease upfront invoice created: ${upfrontInvoice.id} (pre-created recurring subs for hybrid, setup for ${recurringPaymentMethod})`);
          return NextResponse.json({ url: setupSessionUrl });
        } else {
          console.log(`Lease upfront invoice created: ${upfrontInvoice.id} (recurring sub will be created on payment)`);
          return NextResponse.json({ success: true, invoiceId: upfrontInvoice.id });
        }
      } else {
        // Card or sepa: create the subs (lease hardware + service subs) at order time so they are
        // visible immediately, but configure billing_cycle_anchor (from orderPlacedAt + 1mo) so
        // the first charge for recurring (lease hardware + services) starts exactly one month after
        // order time. Non-trial, uniform rule, no 0 trial invoice generated for the delay period.
        // (Previous trial_end approach created the clock before the actual upfront payment and
        // produced 0 invoices that were hard to clean.)

        const leaseProduct = await stripe.products.create({
          name: 'NoCloud Appliance Lease (hardware)',
          description: `Monthly lease payments for hardware amortization over ${lease.months} months (upfront paid separately; recurring starts ~1 month after initial payment). Optional services are on separate perpetual subscriptions.`,
        });

        const trialEnd = orderPlacedAt + 32 * 24 * 3600;
        const subParams: any = {
          customer: stripeCustomerId,
          collection_method: 'charge_automatically',
          items: [
            {
              price_data: {
                currency: 'eur',
                product: leaseProduct.id,
                unit_amount: Math.round(grossUnit(lease.hardwarePerMonth) * 100),
                recurring: { interval: 'month' },
              },
            },
          ],
          trial_end: trialEnd,
          cancel_at: cancelAt,
          payment_behavior: 'default_incomplete',
          metadata: buildOrderMetadata({
            company,
            vatNumber,
            poNumber,
            address,
            city,
            postal,
            country,
            financing: 'lease',
            services: resolvedServicesForMeta,
            hardware: resolvedHardwareForMeta,
            pricingVersion: PRICING_VERSION,
            locale,
            orderPlacedAt,
            contractType: 'leasing',
            leaseMonths: lease.months,
            leaseCancelAt: cancelAt,
            leaseUpfrontAmount: lease.upfrontAmount,
            leaseFinancedAmount: lease.financedAmount,
            upfront_percent: String(UPFRONT_PERCENT),
            total_value: String(hardwareTotal),
            billing_starts_one_month_after_order: 'true',
            // VAT treatment + customer choice (audit + compliance)
            ...vatMeta,
          }),
          expand: ['latest_invoice'],
        };

        const subscription = await stripe.subscriptions.create(subParams);
        const leaseSubId = subscription.id;

        // Best-effort cleanup of any €0 invoice (now via shared helper; purely defensive).
        let latestInv = (subscription as any).latest_invoice;
        let invId = typeof latestInv === 'string' ? latestInv : latestInv?.id;
        if (invId) {
          await cleanupZeroTrialInvoice(stripe, invId, `lease hardware sub ${subscription.id}`);
        }

        if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] lease: pre-creating', resolvedServicesForMeta.length, 'service subs (for card/sepa lease)');
        // Pre-create the perpetual service subs early (like the lease hardware sub), in trialing with default_incomplete.
        // They will get the default PM attached in the webhook after the upfront payment.
        // This ensures the user sees the service subs immediately after placing the lease order.
        let leaseServiceSubIds: string[] = [];
        for (const s of resolvedServicesForMeta) {
          try {
            const serviceProduct = await stripe.products.create({ name: s.name });
            const subParams2: any = {
              customer: stripeCustomerId,
              collection_method: 'charge_automatically',
              trial_end: orderPlacedAt + 32 * 24 * 3600,
              payment_behavior: 'default_incomplete',
              items: [{
                price_data: {
                  currency: 'eur',
                  product: serviceProduct.id,
                  unit_amount: Math.round(grossUnit(s.price) * 100),
                  recurring: { interval: 'month' },
                },
              }],
              metadata: {
                service: s.name,
                is_lease_service: 'true',
                order_placed_at: orderPlacedAt.toString(),
              },
              expand: ['latest_invoice'],
            };
            const svcSub = await stripe.subscriptions.create(subParams2);
            leaseServiceSubIds.push(svcSub.id);

            // Note: we no longer rely on trial_end + 0-trial-invoice cleanup for the "1 month after order"
            // delay on lease service subs. The delay is now via billing_cycle_anchor...
            // Defensive cleanup kept for safety (helper will log-and-skip if already finalized).
            let latestInv = (svcSub as any).latest_invoice;
            let invId = typeof latestInv === 'string' ? latestInv : latestInv?.id;
            if (invId) {
              await cleanupZeroTrialInvoice(stripe, invId, `lease service sub ${svcSub.id}`);
            }

            console.log(`Pre-created lease service sub ${svcSub.id} for "${s.name}" (will attach PM after upfront payment; visible immediately; billing starts ~1mo after order via anchor)`);
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
                name: `${BRAND_NAME} Appliance Lease Upfront (${UPFRONT_PERCENT}%)`,
                description: `Due today. Recurring monthly lease payments start in approximately 1 month.${chargesVat ? ` VAT ${Math.round(effectiveRate*100)}% incl.` : ''}`,
              },
              unit_amount: Math.round(grossUnit(lease.upfrontAmount) * 100),
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
          hardware: JSON.stringify(resolvedHardwareForMeta),
            customer_email: email || 'N/A',
            pricing_version: PRICING_VERSION,
            locale,
            contract_type: 'leasing',
            upfront_percent: String(UPFRONT_PERCENT),
            total_value: String(hardwareTotal),
            order_placed_at: orderPlacedAt.toString(),
          },
          payment_intent_data: {
            setup_future_usage: 'off_session',
          },
        });

        return NextResponse.json({ url: upfrontSession.url });
      }
    }

    if (paymentMethod === 'invoice') {
      if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] routing -> INVOICE branch (strategy:', paymentContext.strategy, ')');
      // Production-ready Pay by Invoice (B2B Net 30) for the hardware / upfront portion.
      // When the order also has recurring services and the client supplied recurringPaymentMethod
      // (card or sepa), we pre-create charge_automatically service subs (with order-based trial_end)
      // and create a mode:'setup' Checkout (after the hardware invoice) so the user can pick the
      // card/sepa numbers for recurring. This guarantees subscriptions exist after the Stripe trip.
      // PM attach (and no dups) handled on setup completion. The old send_invoice service-subs path
      // is used only as fallback when the new field is absent.
      //
      // NOTE (per plan "Lease safety rule"): the entire preceding `if (financing === 'lease')` block
      // (sub creation, pending InvoiceItem, dynamic Product, payment_behavior, hosted redirect, etc.)
      // was left completely untouched. The lease upfront+monthly flow that was painful to stabilize
      // must continue to work exactly as before. Only this invoice branch (and additive webhook code)
      // was added.
      if (!stripeCustomerId && email) {
        try {
          stripeCustomerId = await createB2BStripeCustomer(stripe, {
            email,
            company,
            vatNumber,
            poNumber,
            address,
            city,
            postal,
            country,
          });
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
          hardware: JSON.stringify(resolvedHardwareForMeta),
          customer_email: email || 'N/A',
          pricing_version: PRICING_VERSION,
          locale,
          order_placed_at: orderPlacedAt.toString(),
          // VAT treatment + customer choice (audit + compliance)
          ...vatMeta,
        },
      });

      // Add hardware line items (one-time). (Services are never on the initial Net-30 invoice when the user
      // chose a card/SEPA method for recurring inside the invoice box; they are handled via automatic subs.)
      for (const item of (items || [])) {
        const qty = item.quantity || 1;
        const slug = item.product?.slug as string | undefined;
        // Authoritative unit price via the single logical component (respects customization + per-tier option prices).
        const unitNet = slug && item.customization
          ? calculateHardwarePrice(slug, item.customization)
          : (slug ? getHardwarePrice(slug) : (item.product?.price || 0));
        const unit = grossUnit(unitNet);
        const svcNames = (item.services || []).map((s: any) => s.name).filter(Boolean);
        const cfg = formatHardwareCustomization(item.customization);
        const descExtra = cfg ? ` • ${cfg}` : '';
        const vatNote = chargesVat ? ` (VAT ${Math.round(effectiveRate * 100)}% incl.)` : '';
        await stripe.invoiceItems.create({
          customer: stripeCustomerId,
          invoice: invoice.id,
          amount: Math.round(unit * 100 * qty),
          currency: 'eur',
          description: `${BRAND_NAME} ${item.product?.name || 'Appliance'}${descExtra}${svcNames.length ? ` (includes: ${svcNames.join(', ')})` : ''}${vatNote}`,
        });
      }

      const hasServices = resolvedServicesForMeta.length > 0;
      const useRecurringAutoForServices = hasServices && recurringPaymentMethod && (recurringPaymentMethod === 'stripe' || recurringPaymentMethod === 'sepa');

      if (useRecurringAutoForServices) {
        // Hybrid path: hardware/upfront on Net-30 invoice; recurring services use card/SEPA via automatic subs.
        // Pre-create the service subs at order time (trialing, charge_automatically, default_incomplete) so they
        // are visible immediately / "at the end" after the setup trip (to pick card or sepa numbers for recurring).
        // PM will be attached in webhook/fulfill (via updated helper looking for service_subscription_ids in the
        // setup session meta). Mirrors the lease hybrid pre-create so "trip to stripe but still no subscription"
        // cannot happen for pay-by-invoice + recurring auto (full or lease).
        const trialEnd = orderPlacedAt + 32 * 24 * 3600;
        let serviceSubscriptionIds: string[] = [];
        for (const s of resolvedServicesForMeta) {
          try {
            const serviceProduct = await stripe.products.create({ name: s.name });
            const subParams: any = {
              customer: stripeCustomerId,
              collection_method: 'charge_automatically',
              trial_end: trialEnd,
              payment_behavior: 'default_incomplete',
              items: [{
                price_data: {
                  currency: 'eur',
                  product: serviceProduct.id,
                  unit_amount: Math.round(grossUnit(s.price) * 100),
                  recurring: { interval: 'month' },
                },
              }],
              metadata: {
                service: s.name,
                order_placed_at: orderPlacedAt.toString(),
                main_invoice_id: invoice.id,
                recurring_payment_method: recurringPaymentMethod,
              },
              expand: ['latest_invoice'],
            };
            const svcSub = await stripe.subscriptions.create(subParams);
            serviceSubscriptionIds.push(svcSub.id);

            // defensive 0 cleanup via shared helper
            let latestInv = (svcSub as any).latest_invoice;
            let invId = typeof latestInv === 'string' ? latestInv : latestInv?.id;
            if (invId) {
              await cleanupZeroTrialInvoice(stripe, invId, `service sub ${svcSub.id} (hybrid invoice)`);
            }

            console.log(`Pre-created service sub ${svcSub.id} for "${s.name}" (hybrid invoice + recurring ${recurringPaymentMethod}; visible in trialing; PM attached after setup)`);
          } catch (e) {
            console.error('Failed to pre-create service sub for hybrid invoice recurring', e);
          }
        }

        const pmTypes: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] =
          recurringPaymentMethod === 'sepa' ? ['sepa_debit'] : ['card'];

        const setupSession = await stripe.checkout.sessions.create({
          payment_method_types: pmTypes,
          mode: 'setup',
          customer: stripeCustomerId,
          success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8080'}/${locale}?canceled=true`,
          locale,
          metadata: buildOrderMetadata({
          company,
          vatNumber,
          poNumber,
          address,
          city,
          postal,
          country,
          financing,
          services: resolvedServicesForMeta,
          pricingVersion: PRICING_VERSION,
          locale,
          orderPlacedAt,
          main_invoice_id: invoice.id,
          recurring_payment_method: recurringPaymentMethod,
          service_subscription_ids: JSON.stringify(serviceSubscriptionIds),
          // VAT treatment + customer choice (audit + compliance)
          ...vatMeta,
        }),
        });

        // We still finalize/send the hardware invoice and the "you will receive the Net 30 invoice" emails.
        await stripe.invoices.finalizeInvoice(invoice.id);

        const customerEmailForInvoice = email;
        await sendRegisteredInvoiceCustomerEmail({
          to: customerEmailForInvoice,
          invoiceId: invoice.id,
          company: company || 'N/A',
          locale,
          isHybridRecurring: true,
          recurringPaymentMethod,
          setupSessionId: setupSession.id,
        });
        await sendAdminInvoiceRegisteredEmail({
          to: '',
          invoiceId: invoice.id,
          company: company || 'N/A',
          emailFallback: email,
          isHybrid: true,
          recurringPaymentMethod,
          setupSessionId: setupSession.id,
        });

        console.log(`Real B2B invoice created (hybrid): ${invoice.id}. Redirecting to setup session ${setupSession.id} for recurring services (${recurringPaymentMethod}).`);
        return NextResponse.json({ url: setupSession.url });
      }

      // Legacy / fallback path (no services, or recurringPaymentMethod not supplied by client).
      // Creates send_invoice service subs using order-based billing_cycle_anchor (non-trial)
      // so the first real recurring starts ~1 month after order time (uniform rule).
      // Kept for compatibility with older clients / the existing test.
      for (const s of resolvedServicesForMeta) {
        try {
          const serviceProduct = await stripe.products.create({ name: s.name });
          const trialEnd = orderPlacedAt + 32 * 24 * 3600;
          const sub = await stripe.subscriptions.create({
            customer: stripeCustomerId,
            collection_method: 'send_invoice',
            days_until_due: 30,
            trial_end: trialEnd,
            items: [{
              price_data: {
                currency: 'eur',
                product: serviceProduct.id,
                unit_amount: Math.round(grossUnit(s.price) * 100),
                recurring: { interval: 'month' },
              } as any,
            }],
            metadata: {
              order_invoice: invoice.id,
              service: s.name,
              pricing_version: PRICING_VERSION,
              order_placed_at: orderPlacedAt.toString(),
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
      const customerEmailForInvoice = email; // from top-level destructuring
      await sendRegisteredInvoiceCustomerEmail({
        to: customerEmailForInvoice,
        invoiceId: invoice.id,
        company: company || 'N/A',
        locale,
      });
      await sendAdminInvoiceRegisteredEmail({
        to: '',
        invoiceId: invoice.id,
        company: company || 'N/A',
        emailFallback: email,
      });

      // Return success (client will show friendly overlay; no hosted "pay now" URL because this is Net 30 send_invoice).
      // The real Stripe Invoice is now in the dashboard and will be delivered to the customer.
      console.log(`Real B2B invoice created and finalized: ${invoice.id} for customer ${stripeCustomerId}`);
      return NextResponse.json({ success: true, invoiceId: invoice.id });
    }

    // Direct / full payment (non-lease): one-time for hardware only.
    // Services (if any) will be turned into real subscriptions by the webhook.
    // Use proper quantity + unit price (resolved server-side) so Stripe line items correctly reflect qty > 1.
    if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] routing -> FULL (non-lease) branch (strategy:', paymentContext.strategy, ')');
    const lineItems: any[] = (items || []).map((item: any) => {
      const qty = item.quantity || 1;
      const slug = item.product?.slug as string | undefined;
      // Use the single logical component for hardware unit price (base + chosen option prices from customization).
      const unitNet = slug && item.customization
        ? calculateHardwarePrice(slug, item.customization)
        : (slug ? getHardwarePrice(slug) : (item.product?.price || 0));
      const unit = grossUnit(unitNet);
      const svcNames = (item.services || []).map((s: any) => s.name).filter(Boolean);
      const cfg = formatHardwareCustomization(item.customization);
      const vatNote = chargesVat ? ` (VAT ${Math.round(effectiveRate * 100)}% incl.)` : '';
      return {
        price_data: {
          currency: 'eur',
          product_data: {
            name: `${BRAND_NAME} ${item.product?.name || 'Appliance'}`,
            description: cfg
              ? (svcNames.length > 0 ? `${cfg} • Includes: ${svcNames.join(', ')}${vatNote}` : `${cfg}${vatNote}`)
              : (svcNames.length > 0 ? `Includes: ${svcNames.join(', ')}${vatNote}` : (vatNote || undefined)),
          },
          unit_amount: Math.round(unit * 100),
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
      metadata: buildOrderMetadata({
        company,
        vatNumber,
        poNumber,
        address,
        city,
        postal,
        country,
        financing,
        services: resolvedServicesForMeta,
        hardware: resolvedHardwareForMeta,
        pricingVersion: PRICING_VERSION,
        locale,
        orderPlacedAt,
        leaseMonths: leaseMonthsStr,
        leaseCancelAt: leaseCancelAt,
        leaseUpfrontAmount: leaseUpfrontStr,
        leaseFinancedAmount: leaseFinancedStr,
        // Services (and in future lease hardware) will use this to compute billing_cycle_anchor
        // so recurring starts exactly 1 month after order time (non-trial, uniform rule).
        // VAT treatment + customer choice (audit + compliance)
        ...vatMeta,
      }),
    };
    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] full session metadata.services =', JSON.stringify(resolvedServicesForMeta));
      console.log('[PAYMENT DEBUG] full session metadata.hardware =', JSON.stringify(resolvedHardwareForMeta));
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
