import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { DEBUG_PAYMENTS } from '@/lib/pricing';
import {
  createFullServiceSubscriptions,
  createPreorderServiceSubscriptions,
  createRecurringServiceSubscription,
  servicesFromOrderMetadata,
} from '@/lib/create-service-subscriptions';
import {
  sendOrderConfirmationCustomerEmail,
  sendAdminOrderNotificationEmail,
  sendInvoicePaidCustomerEmail,
  sendRecurringPaymentFailedEmail,
  sendAdminRecurringPaymentFailureEmail,
} from '@/lib/emails';
import { mapStripeErrorToMessage } from '@/lib/stripe-errors';
import { createPaymentMethodUpdateUrl } from '@/lib/stripe-billing-portal';
import {
  isServiceSubscription,
  processSubscriptionDunning,
} from '@/lib/recurring-dunning';
import { extractPaymentMethodFromSession, setDefaultPaymentMethodOnCustomerAndSubs } from '@/lib/stripe-pm';
import { handleSubscriptionTrialInvoice } from '@/lib/stripe-invoices';
import { BRAND_NAME } from '@/lib/brand';
import { buildOrderDisplayFromMetadata } from '@/lib/order-display';

async function provisionPreorderServicesAfterBalancePaid(
  stripe: Stripe,
  meta: Record<string, string>,
  customerId: string,
  balancePaidAtUnix: number,
  defaultPaymentMethod?: string,
) {
  const depositSessionId = meta.deposit_session_id;
  const servicesJson = meta.services;
  if (!depositSessionId || !servicesJson || servicesJson === '[]') {
    return;
  }
  const pricingVer = meta.pricing_version || meta.pricingVersion || 'unknown';
  await createPreorderServiceSubscriptions(stripe, {
    customerId,
    depositSessionId,
    servicesJson,
    pricingVersion: pricingVer,
    balancePaidAtUnix,
    defaultPaymentMethod,
  });
}

export async function POST(request: NextRequest) {
  console.log('[PAYMENT DEBUG] /api/webhook/stripe route invoked, STRIPE_WEBHOOK_SECRET present:', !!process.env.STRIPE_WEBHOOK_SECRET, 'STRIPE_SECRET_KEY present:', !!process.env.STRIPE_SECRET_KEY);

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

  if (DEBUG_PAYMENTS) {
    console.log('[PAYMENT DEBUG] webhook event parsed successfully, type=', event.type, 'id=', event.id);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    // Re-retrieve the session with expansion to reliably obtain the payment_method used
    // for card (and sepa) payments in 'payment' mode *and* for mode:'setup' sessions (the hybrid
    // Pay-by-Invoice-for-hardware + card/SEPA-for-recurring-services flow). Expanding both kinds of
    // intent ensures we get the PM for service sub creation (full path) and lease PM attachment.
    // Falls back to prior logic.
    let expandedSession: Stripe.Checkout.Session = session;
    try {
      expandedSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['payment_intent.payment_method', 'setup_intent.payment_method'],
      });
    } catch (expErr) {
      console.warn('Could not re-retrieve/expand checkout session for PM; using event payload + fallbacks', expErr);
    }

    const metadata = session.metadata || {};
    const customerEmail = session.customer_details?.email || (metadata as any).customer_email || (metadata as any).customerEmail;
    const orderId = session.id;
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

    // VAT treatment / choice fields (for emails + audit)
    const vatInclusive = (metadata.vat_inclusive_choice === 'true') || (metadata.vatInclusive === 'true');
    const vatTreatment = (metadata.vat_treatment as string) || undefined;
    const vatRate = metadata.vat_rate ? parseFloat(String(metadata.vat_rate)) : undefined;
    const netTotal = metadata.net_total ? parseFloat(String(metadata.net_total)) : undefined;
    const vatAmountMeta = metadata.vat_amount ? parseFloat(String(metadata.vat_amount)) : undefined;
    const grossTotal = metadata.gross_total ? parseFloat(String(metadata.gross_total)) : undefined;

    const { servicesStr, hardwareStr } = buildOrderDisplayFromMetadata(metadata, pricingVersion);
    const servicesArray = servicesFromOrderMetadata(metadata.services, pricingVersion);
    const isPreorder = metadata.order_type === 'preorder';
    if (DEBUG_PAYMENTS || servicesArray.length > 0) {
      console.log(`[PAYMENT DEBUG] checkout.session.completed: order=${orderId} financing=${financing} customer=${session.customer} servicesLen=${servicesArray.length} rawServicesMeta=${metadata.services}`);
    } else {
      console.log(`checkout.session.completed: order=${orderId} financing=${financing} customer=${session.customer} servicesLen=${servicesArray.length}`);
    }

    // In the hybrid "invoice for hardware + setup for recurring services" flow we already sent the
    // "invoice registered" email from the route. Skip the generic checkout confirmation email here
    // to avoid duplicates. Subs creation (below) still runs.
    const isSetupForRecurringServicesUnderInvoice = session.mode === 'setup' && servicesArray.length > 0 && financing !== 'lease' && !metadata.lease_subscription_id && !metadata.is_lease_upfront;

    const upfrontAmountForEmail = (metadata as any).lease_upfront_amount;

    // Customer email - invoice / confirmation (rich thanks)
    const paymentSucceeded = session.payment_status === 'paid';

    if (customerEmail && !isSetupForRecurringServicesUnderInvoice && paymentSucceeded) {
      await sendOrderConfirmationCustomerEmail({
        to: customerEmail,
        orderId,
        amount,
        currency,
        financing,
        leaseMonths,
        upfrontAmount: upfrontAmountForEmail,
        servicesStr,
        hardwareStr,
        companyName,
        vatNumber,
        poNumber,
        pricingVersion,
        locale: orderLocale,
        isPreorderDeposit: isPreorder,
        balanceDue: metadata.quoted_balance_due,
        quotedHardwareTotal: metadata.quoted_hardware_total,
        vatInclusive,
        vatTreatment,
        vatRate,
        netTotal,
        vatAmount: vatAmountMeta,
        grossTotal,
      });
    }

    // Detailed admin notification — only after successful payment (not on invoice registration or failures).
    if (process.env.ADMIN_EMAIL && !isSetupForRecurringServicesUnderInvoice && paymentSucceeded) {
      await sendAdminOrderNotificationEmail({
        orderId,
        amount,
        currency,
        financing,
        leaseMonths,
        upfrontAmount: upfrontAmountForEmail,
        servicesStr,
        hardwareStr,
        companyName,
        vatNumber,
        poNumber,
        pricingVersion,
        locale: orderLocale,
        customerEmail,
        orderType: isPreorder ? 'preorder' : undefined,
        preorderStatus: isPreorder ? 'deposit_paid' : undefined,
        depositAmount: isPreorder ? metadata.quoted_deposit : undefined,
        balanceDue: isPreorder ? metadata.quoted_balance_due : undefined,
        quotedTotal: isPreorder ? metadata.quoted_hardware_total : undefined,
        priceLockPolicy: isPreorder ? metadata.price_lock_policy : undefined,
        vatInclusive,
        vatTreatment,
        vatRate,
        netTotal,
        vatAmount: vatAmountMeta,
        grossTotal,
      });
    }

    if (isPreorder && paymentSucceeded) {
      try {
        await stripe.checkout.sessions.update(session.id, {
          metadata: { preorder_status: 'deposit_paid' },
        });
      } catch (metaErr) {
        console.warn('Could not update preorder deposit session status', metaErr);
      }
    }

    if (isPreorder && session.customer && paymentSucceeded) {
      const defaultPaymentMethod = await extractPaymentMethodFromSession(stripe, expandedSession || session);
      if (defaultPaymentMethod) {
        await setDefaultPaymentMethodOnCustomerAndSubs(
          stripe,
          session.customer as string,
          defaultPaymentMethod,
          [],
        );
      }
    }

    // For direct purchases (financing=full), turn selected services into real recurring Subscriptions.
    // The pm collected by the one-time Checkout session must be explicitly attached so the
    // monthly subs can actually charge (without this, subs are often created without a default pm
    // and won't auto-bill, especially noticeable with SEPA). Robustness added for subsequent cycles...
    // Now delegated to shared helper (with idempotency check + default_incomplete fallback).
    if (session.customer && financing !== 'lease' && !isPreorder && servicesArray.length > 0) {
      if (DEBUG_PAYMENTS) {
        console.log('[PAYMENT DEBUG] delegating to createFullServiceSubscriptions (webhook path) for', orderId);
      }
      await createFullServiceSubscriptions(stripe, session, metadata.services!, pricingVersion);
    }

    // Handle pre-created lease subscription (from the new lease flow where upfront is paid separately
    // via Checkout and the sub was created with trial_end so recurring monthly starts ~1 month later).
    // Attach the PM collected on the upfront payment to the customer and to the lease sub.
    if (session.customer && (metadata.is_lease_upfront || metadata.lease_subscription_id)) {
      if (DEBUG_PAYMENTS) console.log('[PAYMENT DEBUG] entering lease upfront PM attach block');

      const defaultPaymentMethod = await extractPaymentMethodFromSession(stripe, expandedSession || session);

      if (defaultPaymentMethod && session.customer) {
        const leaseSubId = metadata.lease_subscription_id as string | undefined;
        let serviceSubIds: string[] = [];
        if (metadata.lease_service_sub_ids) {
          try { serviceSubIds = JSON.parse(metadata.lease_service_sub_ids as string); } catch {}
        }

        await setDefaultPaymentMethodOnCustomerAndSubs(
          stripe,
          session.customer as string,
          defaultPaymentMethod,
          [leaseSubId, ...serviceSubIds].filter(Boolean) as string[]
        );

        if (leaseSubId) {
          console.log(`Attached PM ${defaultPaymentMethod} to pre-created lease sub ${leaseSubId} (from upfront payment)`);
        }
        for (const svcSubId of serviceSubIds) {
          console.log(`Attached PM to pre-created lease service sub ${svcSubId} from upfront payment`);
        }
      }
    }

    // For lease mode, set cancel_at on the subscription AFTER it's created by Checkout.
    // subscription_data.cancel_at is not a supported parameter when creating
    // Checkout sessions (even with recent API versions).
    // (New lease flow uses direct subscriptions.create which sets cancel_at at creation time.)
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

  // New lease flow (feature/lease-max-upfront): subscriptions are created directly with
  // add_invoice_items (upfront one-time) + recurring item. The initial invoice (containing
  // upfront + first month) is paid via hosted_invoice_url. We confirm the order on invoice.paid.
  if (event.type === 'invoice.paid') {
    const invoice = event.data.object as Stripe.Invoice;

    const subId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : (invoice.subscription as Stripe.Subscription | null | undefined)?.id;

    // Standalone B2B pay-by-invoice (the initial net30 for hardware +/- first services) has no subscription.
    // Send paid confirmation (we already sent "registered, you will receive the invoice" at creation time).
    if (!subId) {
      const invMeta = (invoice as any).metadata || {};
      const invFinancing = invMeta.financing || 'full';
      const isPreorderInv = invMeta.order_type === 'preorder';
      const isBalanceCharge = invMeta.is_balance_charge === 'true';
      const invPricingVersion = invMeta.pricing_version || invMeta.pricingVersion || 'unknown';
      const invDisplay = buildOrderDisplayFromMetadata(invMeta, invPricingVersion);

      if (invFinancing === 'full' || (invFinancing === 'lease' && invMeta.is_upfront_only) || isPreorderInv) {
        const isLeaseUpfront = invFinancing === 'lease' && invMeta.is_upfront_only && !isPreorderInv;

        if (isLeaseUpfront) {
          // Create the recurring lease subscription now that the upfront has been paid.
          // Use trial_end so the first paid monthly starts ~1 month after this payment (the "initial payment").
          try {
            const hardwareMonthly = parseFloat(invMeta.lease_hardware_monthly_amount || invMeta.lease_monthly_amount || '0');
            const months = parseInt(invMeta.lease_months || '12');
            const cancelAt = parseInt(invMeta.lease_cancel_at || '0');
            const upfrontAmount = parseFloat(invMeta.lease_upfront_amount || '0');

            const preCreatedLeaseSub = invMeta.lease_subscription_id;
            if (preCreatedLeaseSub) {
              console.log(`Lease upfront invoice ${invoice.id} paid; pre-created recurring subs (e.g. ${preCreatedLeaseSub}) from hybrid setup exist (PM attach happened on setup), skipping duplicate creation on paid.`);
            } else if (hardwareMonthly > 0 && cancelAt > 0) {
              const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;

              const leaseProduct = await stripe.products.create({
                name: `${BRAND_NAME} Appliance Lease (hardware)`,
                description: `Monthly lease payment for hardware amortization over ${months} months. Recurring starts ~1 month after payment of upfront invoice ${invoice.id}. (Services on separate perpetual subscriptions.)`,
              });

              // Use original order time (if present) to compute trial_end for consistent
              // "recurring starts 1 month after order time".
              const orderTs = invMeta.order_placed_at ? parseInt(invMeta.order_placed_at, 10) : Math.floor(Date.now() / 1000);
              const trialEnd = orderTs + 32 * 24 * 3600;

              const recurringMethod = invMeta.recurring_payment_method;
              const isAuto = recurringMethod && (recurringMethod === 'stripe' || recurringMethod === 'sepa');

              let defaultPaymentMethod;
              if (isAuto) {
                try {
                  const pms = await stripe.customers.listPaymentMethods(customerId, { limit: 5 });
                  const recent = pms.data.find((p: any) => p.type === 'card' || p.type === 'sepa_debit');
                  if (recent?.id) defaultPaymentMethod = recent.id;
                } catch (e) {}
              }

              const leaseSubParams: any = {
                customer: customerId,
                items: [{
                  price_data: {
                    currency: 'eur',
                    product: leaseProduct.id,
                    unit_amount: Math.round(hardwareMonthly * 100),
                    recurring: { interval: 'month' },
                  },
                }],
                trial_end: trialEnd,
                cancel_at: cancelAt,
                metadata: {
                  ...invMeta,
                  is_upfront_only: undefined,
                  is_recurring_lease_sub: 'true',
                  lease_upfront_invoice_paid: invoice.id,
                  order_placed_at: orderTs.toString(),
                },
              };
              if (isAuto) {
                leaseSubParams.collection_method = 'charge_automatically';
                if (defaultPaymentMethod) leaseSubParams.default_payment_method = defaultPaymentMethod;
              } else {
                leaseSubParams.collection_method = 'send_invoice';
                leaseSubParams.days_until_due = 30;
              }
              const sub = await stripe.subscriptions.create(leaseSubParams);

              console.log(`Created lease recurring sub ${sub.id} on payment of upfront invoice ${invoice.id} (trial ends ~1 month after payment)`);

              const pricingVer = invMeta.pricing_version || invMeta.pricingVersion || 'unknown';
              const servicesArray = servicesFromOrderMetadata(invMeta.services, pricingVer);
              console.log(`Lease paid for ${invoice.id}: creating ${servicesArray.length} service subs (perpetual, independent of lease term)`);
              for (const svc of servicesArray) {
                try {
                  const svcSub = await createRecurringServiceSubscription(stripe, customerId, svc, {
                    trial_end: trialEnd,
                    collection_method: isAuto ? 'charge_automatically' : 'send_invoice',
                    ...(isAuto && defaultPaymentMethod
                      ? { default_payment_method: defaultPaymentMethod }
                      : {}),
                    ...(!isAuto ? { days_until_due: 30 } : {}),
                    metadata: {
                      lease_upfront_invoice_paid: invoice.id,
                      is_lease_service: 'true',
                      order_placed_at: orderTs.toString(),
                    },
                    expand: ['latest_invoice'],
                  });

                  const latestInv = (svcSub as any).latest_invoice;
                  const invId = latestInv ? (typeof latestInv === 'string' ? latestInv : latestInv.id) : undefined;
                  if (invId) {
                    await handleSubscriptionTrialInvoice(stripe, invId, `lease service sub ${svcSub.id}`, {
                      description: `Trial period for ${svc.name} (appliance S/N ${svc.hostSerialNumber}; lease service subscription ${svcSub.id}). Recurring payments start after trial (~1 month after upfront payment ${invoice.id}). Services continue independently after the lease term ends.`,
                      footer: 'This service subscription continues after the lease hardware payments end.',
                    });
                  }
                  console.log(`Created lease service sub ${svcSub.id} for "${svc.name}" (S/N ${svc.hostSerialNumber}) on payment of ${invoice.id}`);
                } catch (svcErr) {
                  console.error('Failed to create lease service sub on upfront payment', svcErr);
                }
              }
            } else if (!preCreatedLeaseSub) {
              console.warn('Missing lease details in meta for sub creation on upfront paid', invMeta);
            }
          } catch (subErr) {
            console.error('Failed to create lease sub on upfront payment', subErr);
          }
        }

        const customerEmail = invoice.customer_email || (invMeta as any).customer_email || '';
        const orderLocale = (invMeta.locale as string) || 'en';
        const amountPaid = invoice.amount_paid ? (invoice.amount_paid / 100).toFixed(2) : '0.00';
        const curr = (invoice.currency || 'eur').toUpperCase();

        // VAT extraction for paid path (use invMeta which was built above)
        const vatInclusivePaid = (invMeta.vat_inclusive_choice === 'true') || (invMeta.vatInclusive === 'true');
        const vatTreatmentPaid = (invMeta.vat_treatment as string) || undefined;
        const vatRatePaid = invMeta.vat_rate ? parseFloat(String(invMeta.vat_rate)) : undefined;
        const netTotalPaid = invMeta.net_total ? parseFloat(String(invMeta.net_total)) : undefined;
        const vatAmountPaid = invMeta.vat_amount ? parseFloat(String(invMeta.vat_amount)) : undefined;
        const grossTotalPaid = invMeta.gross_total ? parseFloat(String(invMeta.gross_total)) : undefined;

        if (isPreorderInv) {
          await sendOrderConfirmationCustomerEmail({
            to: customerEmail,
            orderId: invoice.id,
            amount: amountPaid,
            currency: curr,
            financing: 'full',
            servicesStr: invDisplay.servicesStr,
            hardwareStr: invDisplay.hardwareStr,
            companyName: invMeta.company_name || invMeta.companyName || 'N/A',
            vatNumber: invMeta.vat_number || invMeta.vatNumber || 'N/A',
            poNumber: invMeta.po_number || invMeta.poNumber || 'N/A',
            pricingVersion: invPricingVersion,
            locale: orderLocale,
            isPreorderDeposit: !isBalanceCharge,
            balanceDue: isBalanceCharge ? undefined : invMeta.quoted_balance_due,
            quotedHardwareTotal: invMeta.quoted_hardware_total,
            vatInclusive: vatInclusivePaid,
            vatTreatment: vatTreatmentPaid,
            vatRate: vatRatePaid,
            netTotal: netTotalPaid,
            vatAmount: vatAmountPaid,
            grossTotal: grossTotalPaid,
          });
        } else {
          await sendInvoicePaidCustomerEmail({
            to: customerEmail,
            invoiceId: invoice.id,
            vatInclusive: vatInclusivePaid,
            vatTreatment: vatTreatmentPaid,
            vatRate: vatRatePaid,
            netTotal: netTotalPaid,
            vatAmount: vatAmountPaid,
            grossTotal: grossTotalPaid,
            amountPaid,
            currency: curr,
            locale: orderLocale,
            isLeaseUpfront,
          });
        }

        if (process.env.ADMIN_EMAIL) {
          await sendAdminOrderNotificationEmail({
            orderId: invoice.id,
            amount: amountPaid,
            currency: curr,
            financing: invFinancing,
            servicesStr: invDisplay.servicesStr,
            hardwareStr: invDisplay.hardwareStr,
            companyName: invMeta.company_name || invMeta.companyName || 'N/A',
            vatNumber: invMeta.vat_number || invMeta.vatNumber || 'N/A',
            poNumber: invMeta.po_number || invMeta.poNumber || 'N/A',
            pricingVersion: invPricingVersion,
            locale: orderLocale,
            customerEmail,
            invoiceId: invoice.id,
            isLeaseInvoicePaid: isLeaseUpfront,
            orderType: isPreorderInv ? 'preorder' : undefined,
            preorderStatus: isPreorderInv
              ? (isBalanceCharge ? 'balance_paid' : 'deposit_paid')
              : undefined,
            depositAmount: isPreorderInv && !isBalanceCharge ? invMeta.quoted_deposit : undefined,
            balanceDue: isPreorderInv ? invMeta.quoted_balance_due : undefined,
            quotedTotal: isPreorderInv ? invMeta.quoted_hardware_total : undefined,
            priceLockPolicy: isPreorderInv ? invMeta.price_lock_policy : undefined,
            fulfillmentAction: isBalanceCharge ? 'balance_invoice_paid' : undefined,
            vatInclusive: vatInclusivePaid,
            vatTreatment: vatTreatmentPaid,
            vatRate: vatRatePaid,
            netTotal: netTotalPaid,
            vatAmount: vatAmountPaid,
            grossTotal: grossTotalPaid,
          });
        }

        if (isPreorderInv && isBalanceCharge) {
          const customerId = typeof invoice.customer === 'string'
            ? invoice.customer
            : (invoice.customer as { id?: string } | null)?.id;
          let defaultPaymentMethod: string | undefined;
          try {
            const piId = typeof (invoice as Stripe.Invoice).payment_intent === 'string'
              ? (invoice as Stripe.Invoice).payment_intent as string
              : ((invoice as Stripe.Invoice).payment_intent as Stripe.PaymentIntent | null)?.id;
            if (piId) {
              const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
              const pm = (pi as Stripe.PaymentIntent).payment_method;
              defaultPaymentMethod = typeof pm === 'string' ? pm : (pm as Stripe.PaymentMethod | null)?.id;
            }
          } catch (pmErr) {
            console.warn('Could not extract PM from preorder balance invoice', pmErr);
          }
          const paidAt =
            (invoice as Stripe.Invoice).status_transitions?.paid_at ??
            Math.floor(Date.now() / 1000);
          if (customerId) {
            await provisionPreorderServicesAfterBalancePaid(
              stripe,
              invMeta as Record<string, string>,
              customerId,
              paidAt,
              defaultPaymentMethod,
            );
          }
        }

        console.log(`${isPreorderInv ? 'Pre-order' : isLeaseUpfront ? 'Lease upfront' : 'B2B pay-by-invoice'} paid: ${invoice.id}`);
      }
      return NextResponse.json({ received: true });
    }

    let sub: Stripe.Subscription;
    try {
      sub = await stripe.subscriptions.retrieve(subId);
    } catch (subErr) {
      console.warn('Could not retrieve subscription for paid invoice', subId, subErr);
      return NextResponse.json({ received: true });
    }

    const metadata = sub.metadata || {};
    const financing = metadata.financing || 'full';
    if (financing !== 'lease') {
      // Service-only recurring subs for 'full' purchases are still created from checkout.session.completed path (or send subs for invoice).
      return NextResponse.json({ received: true });
    }

    // === LEASE RECURRING PM ATTACHMENT (additive only — see plan "Lease safety rule") ===
    // The stabilized lease creation path (direct subscriptions.create with payment_behavior default_incomplete,
    // pending InvoiceItem for upfront, hosted_invoice_url for initial payment) is intentionally left 100% untouched.
    // This block runs *after* successful payment of the initial invoice (upfront + month 1) and ensures the
    // PM collected via the hosted page is explicitly set as default on the customer and this subscription.
    // This mirrors the explicit attachment done for full+services in the session.completed path and guarantees
    // future monthly invoices (under charge_automatically + the sub's cancel_at) will auto-bill reliably,
    // especially for SEPA.
    // Placed here (post-retrieve, inside the lease guard) so it is purely confirmatory and cannot affect
    // the initial hosted collection or sub creation that took significant effort to stabilize.
    //
    // Note: for invoice.paid we don't have a full Checkout Session, so we use a lightweight extraction
    // from the invoice's payment_intent + customer list fallback (the shared helper is session-oriented).
    let defaultPaymentMethod: string | undefined;
    try {
      const piId = typeof (invoice as any).payment_intent === 'string'
        ? (invoice as any).payment_intent
        : (invoice as any).payment_intent?.id;
      if (piId) {
        const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method'] });
        const pm = (pi as any).payment_method;
        defaultPaymentMethod = typeof pm === 'string' ? pm : pm?.id;
      }
    } catch (pmErr) {
      console.warn('Could not retrieve payment_method from paid lease invoice for default attachment', pmErr);
    }

    // Additive fallback (list recent PM)
    if (!defaultPaymentMethod && sub.customer) {
      try {
        const pms = await stripe.customers.listPaymentMethods(sub.customer as string, { limit: 5 });
        const recent = pms.data.find((p: any) => p.type === 'card' || p.type === 'sepa_debit');
        defaultPaymentMethod = recent?.id;
      } catch (listErr) {
        console.warn('Could not list PMs for lease attach fallback', listErr);
      }
    }

    if (defaultPaymentMethod && sub.customer) {
      await setDefaultPaymentMethodOnCustomerAndSubs(stripe, sub.customer as string, defaultPaymentMethod, [sub.id]);
      console.log(`Attached default PM ${defaultPaymentMethod} to lease customer/sub ${sub.id} for future recurring cycles`);
    }
    // === end additive lease recurring attachment ===

    // Lease order paid (upfront + recurring initial invoice paid via hosted invoice page)
    const orderId = invoice.id || sub.id;
    const amount = invoice.amount_paid ? (invoice.amount_paid / 100).toFixed(2) : '0.00';
    const currency = (invoice.currency || 'eur').toUpperCase();

    const customerEmail = invoice.customer_email ||
      (invoice as any).customer_details?.email ||
      (metadata as any).customer_email ||
      (metadata as any).customerEmail ||
      '';

    const companyName = metadata.company_name || metadata.companyName || 'N/A';
    const vatNumber = metadata.vat_number || metadata.vatNumber || 'N/A';
    const poNumber = metadata.po_number || metadata.poNumber || 'N/A';
    const leaseMonths = metadata.lease_months || metadata.leaseMonths || '';
    const pricingVersion = metadata.pricing_version || metadata.pricingVersion || 'unknown';
    const orderLocale = (metadata.locale as string) || 'en';
    const isFr = orderLocale === 'fr';

    let servicesStr = 'None';
    const leaseServicesArray = servicesFromOrderMetadata(metadata.services, pricingVersion);
    if (leaseServicesArray.length > 0) {
      servicesStr = leaseServicesArray.map((s) => {
        const host = s.hostSerialNumber ? `, appliance S/N ${s.hostSerialNumber}` : '';
        return `${s.name} (€${s.price}/mo${host})`;
      }).join(', ');
    }
    let hardwareStr = 'Standard';
    try {
      if (metadata.hardware) {
        const hw = typeof metadata.hardware === 'string' ? JSON.parse(metadata.hardware) : metadata.hardware;
        if (Array.isArray(hw) && hw.length > 0) {
          hardwareStr = hw.map((h: any) => {
            const base = h.name || '';
            const cfg = h.config && h.config !== 'Standard' ? ` (${h.config})` : '';
            return `${base}${cfg}`;
          }).join(', ');
        }
      }
    } catch {}

    // Customer email (rich thanks for lease paid)
    await sendOrderConfirmationCustomerEmail({
      to: customerEmail,
      orderId,
      amount,
      currency,
      financing,
      leaseMonths,
      upfrontAmount: (metadata as any).lease_upfront_amount,
      servicesStr,
      hardwareStr,
      companyName,
      vatNumber,
      poNumber,
      pricingVersion,
      locale: orderLocale,
      isLeaseInvoicePaid: true,
    });

    // Admin notification for lease invoice payment
    await sendAdminOrderNotificationEmail({
      orderId,
      amount,
      currency,
      financing,
      leaseMonths,
      upfrontAmount: (metadata as any).lease_upfront_amount,
      servicesStr,
      hardwareStr,
      companyName,
      vatNumber,
      poNumber,
      pricingVersion,
      locale: orderLocale,
      customerEmail,
      subscriptionId: sub.id,
      invoiceId: invoice.id,
      isLeaseInvoicePaid: true,
    });

    console.log(`Lease order paid (invoice): ${orderId} (sub ${sub.id})`);
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const subId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : (invoice.subscription as Stripe.Subscription | null | undefined)?.id;

    if (subId) {
      try {
        const sub = await stripe.subscriptions.retrieve(subId);
        if (isServiceSubscription(sub) && sub.collection_method === 'charge_automatically') {
          const meta = sub.metadata || {};
          const locale = (meta.locale as string) || 'en';
          const isFirstFailure = !meta.first_payment_failed_at;

          let failureReason = mapStripeErrorToMessage({ code: 'payment_failed' }, locale);
          try {
            const piId = typeof invoice.payment_intent === 'string'
              ? invoice.payment_intent
              : (invoice.payment_intent as Stripe.PaymentIntent | null)?.id;
            if (piId) {
              const pi = await stripe.paymentIntents.retrieve(piId);
              if (pi.last_payment_error) {
                failureReason = mapStripeErrorToMessage(pi.last_payment_error, locale);
              }
            }
          } catch {
            // keep default reason
          }

          const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
          let customerEmail = meta.customer_email || invoice.customer_email || '';
          if (!customerEmail && customerId) {
            try {
              const customer = await stripe.customers.retrieve(customerId);
              if (!customer.deleted) {
                customerEmail = (customer as Stripe.Customer).email || '';
              }
            } catch {
              // proceed
            }
          }

          const nowUnix = Math.floor(Date.now() / 1000);
          const patch: Record<string, string> = {
            last_payment_failure_reason: failureReason,
          };
          if (isFirstFailure) {
            patch.first_payment_failed_at = String(nowUnix);
            patch.dunning_stage = 'failed';
          }

          const updated = await stripe.subscriptions.update(subId, { metadata: patch });

          if (customerId) {
            const portalUrl = await createPaymentMethodUpdateUrl(stripe, customerId);
            const emailCtx = {
              customerEmail,
              serviceName: meta.service || 'Service',
              hostSerialNumber: meta.host_serial_number || meta.serial_number,
              failureReason,
              portalUrl,
              locale,
              subscriptionId: subId,
            };

            if (isFirstFailure) {
              if (customerEmail) {
                await sendRecurringPaymentFailedEmail(emailCtx);
              }
              await sendAdminRecurringPaymentFailureEmail(emailCtx);
            }

            await processSubscriptionDunning(stripe, updated, { nowUnix });
          }
        }
      } catch (dunningErr) {
        console.error('invoice.payment_failed dunning handler error', dunningErr);
      }
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent;
    const piMeta = pi.metadata || {};
    if (piMeta.is_balance_charge === 'true' && piMeta.order_type === 'preorder') {
      const pricingVer = piMeta.pricing_version || piMeta.pricingVersion || 'unknown';
      const display = buildOrderDisplayFromMetadata(piMeta, pricingVer);
      const amount = pi.amount_received ? (pi.amount_received / 100).toFixed(2) : '0.00';
      const currency = (pi.currency || 'eur').toUpperCase();
      const customerEmail = piMeta.customer_email || pi.receipt_email || '';
      const orderLocale = (piMeta.locale as string) || 'en';

      if (customerEmail) {
        await sendOrderConfirmationCustomerEmail({
          to: customerEmail,
          orderId: pi.id,
          amount,
          currency,
          financing: 'full',
          servicesStr: display.servicesStr,
          hardwareStr: display.hardwareStr,
          companyName: piMeta.company_name || 'N/A',
          vatNumber: piMeta.vat_number || 'N/A',
          poNumber: piMeta.po_number || 'N/A',
          pricingVersion: pricingVer,
          locale: orderLocale,
          quotedHardwareTotal: piMeta.quoted_hardware_total,
        });
      }

      if (process.env.ADMIN_EMAIL) {
        await sendAdminOrderNotificationEmail({
          orderId: pi.id,
          amount,
          currency,
          financing: 'full',
          servicesStr: display.servicesStr,
          hardwareStr: display.hardwareStr,
          companyName: piMeta.company_name || 'N/A',
          vatNumber: piMeta.vat_number || 'N/A',
          poNumber: piMeta.po_number || 'N/A',
          pricingVersion: pricingVer,
          locale: orderLocale,
          customerEmail,
          orderType: 'preorder',
          preorderStatus: 'balance_paid',
          balanceDue: piMeta.quoted_balance_due,
          quotedTotal: piMeta.quoted_hardware_total,
          priceLockPolicy: piMeta.price_lock_policy,
          fulfillmentAction: 'balance_auto_charge',
        });
      }

      const customerId = typeof pi.customer === 'string' ? pi.customer : pi.customer?.id;
      let defaultPaymentMethod: string | undefined;
      const pm = pi.payment_method;
      defaultPaymentMethod = typeof pm === 'string' ? pm : (pm as Stripe.PaymentMethod | null)?.id;
      const balancePaidAt = pi.created || Math.floor(Date.now() / 1000);
      if (customerId) {
        await provisionPreorderServicesAfterBalancePaid(
          stripe,
          piMeta as Record<string, string>,
          customerId,
          balancePaidAt,
          defaultPaymentMethod,
        );
      }

      console.log(`Pre-order balance charged: ${pi.id}`);
    }
  }

  return NextResponse.json({ received: true });
}
