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
      const upfront = (metadata as any).lease_upfront_amount;
      const upfrontNote = (financing === 'lease' && upfront) ? `<p><strong>Upfront payment:</strong> €${upfront}</p>` : '';
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
            ${upfrontNote}
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
            ${(financing === 'lease' && (metadata as any).lease_upfront_amount) ? `<p><strong>Upfront payment:</strong> €${(metadata as any).lease_upfront_amount}</p>` : ''}
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
    // and won't auto-bill, especially noticeable with SEPA). Robustness added for subsequent cycles:
    // listPaymentMethods fallback, customer default set before+after loop, and one retry on "no default" errors.
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

      // Fallback: most recent card or sepa_debit on the customer (covers cases where session/PI do not surface it directly).
      if (!defaultPaymentMethod && session.customer) {
        try {
          const pms = await stripe.customers.listPaymentMethods(session.customer as string, { limit: 5 });
          const recent = pms.data.find((p: any) => p.type === 'card' || p.type === 'sepa_debit');
          defaultPaymentMethod = recent?.id;
        } catch (listErr) {
          console.warn('Could not list recent PMs for service subs fallback', listErr);
        }
      }

      // Set as customer's default (before creations) so any future subscriptions or retries see it.
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
          // In this API version, subscriptions.create requires a `product` ID (not inline
          // `product_data`) inside price_data. Create a lightweight Product per service.
          const serviceProduct = await stripe.products.create({
            name: s.name,
          });

          const subParams: any = {
            customer: session.customer as string,
            collection_method: 'charge_automatically',
            trial_end: Math.floor(Date.now() / 1000) + 32 * 24 * 3600, // recurring starts ~1 month after initial hardware payment
            items: [{
              price_data: {
                currency: 'eur',
                product: serviceProduct.id,
                unit_amount: Math.round(s.price * 100),
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
          const createdSub = await stripe.subscriptions.create(subParams);

          // Re-apply default_payment_method explicitly after creation.
          // Passing it at create time is not always sufficient for *subsequent* billing cycles
          // (month 2+ invoices) to auto-charge reliably, especially with SEPA or when using dynamic price_data.
          // Setting it again on the subscription object makes the PM "stick" for future invoices.
          if (defaultPaymentMethod) {
            try {
              await stripe.subscriptions.update(createdSub.id, {
                default_payment_method: defaultPaymentMethod,
              });
            } catch (reapplyErr) {
              console.warn(`Could not re-apply default PM to service sub ${createdSub.id}`, reapplyErr);
            }
          }

          console.log(`Created service subscription ${createdSub.id} for "${s.name}" on customer ${session.customer} (pm: ${defaultPaymentMethod || 'none'})`);

          // Diagnostic: status of the first service invoice (billed at sub creation time using the attached PM).
          // Helps confirm whether even the initial recurring period succeeded before worrying about month 2+.
          try {
            const firstInv = (createdSub as any).latest_invoice;
            const invId = typeof firstInv === 'string' ? firstInv : firstInv?.id;
            if (invId) {
              const inv = await stripe.invoices.retrieve(invId);
              console.log(`  First invoice ${invId} for sub ${createdSub.id}: status=${inv.status}, paid=${inv.paid}, amount_paid=${inv.amount_paid}`);
            }
          } catch (invLogErr) {
            console.warn('Could not retrieve first service invoice for logging', invLogErr);
          }
        } catch (subErr: any) {
          const msg = (subErr?.message || '').toLowerCase();
          if (msg.includes('default payment') || msg.includes('no attached') || msg.includes('payment source')) {
            console.warn(`Service sub create for "${s.name}" hit no-default; re-setting customer default and retrying once`);
            if (defaultPaymentMethod && session.customer) {
              try {
                await stripe.customers.update(session.customer as string, {
                  invoice_settings: { default_payment_method: defaultPaymentMethod },
                });
              } catch {}
            }
            try {
              // Rebuild minimal for retry (product + sub with same PM)
              const serviceProduct2 = await stripe.products.create({ name: s.name });
              const subParams2: any = {
                customer: session.customer as string,
                collection_method: 'charge_automatically',
                trial_end: Math.floor(Date.now() / 1000) + 32 * 24 * 3600, // recurring starts ~1 month after initial hardware payment
                items: [{
                  price_data: {
                    currency: 'eur',
                    product: serviceProduct2.id,
                    unit_amount: Math.round(s.price * 100),
                    recurring: { interval: 'month' },
                  } as any,
                }],
                metadata: { order_session: orderId, service: s.name },
              };
              if (defaultPaymentMethod) subParams2.default_payment_method = defaultPaymentMethod;
              const retriedSub = await stripe.subscriptions.create(subParams2);

              if (defaultPaymentMethod) {
                try {
                  await stripe.subscriptions.update(retriedSub.id, {
                    default_payment_method: defaultPaymentMethod,
                  });
                } catch (reapplyErr) {
                  console.warn(`Could not re-apply default PM to retried service sub ${retriedSub.id}`, reapplyErr);
                }
              }

              console.log(`Retry succeeded for service sub ${retriedSub.id} "${s.name}" on customer ${session.customer}`);
            } catch (retryErr) {
              console.error('Retry also failed for service subscription', retryErr);
            }
          } else {
            console.error('Failed to create service subscription', subErr);
          }
        }
      }

      // Re-set customer default after the loop (defensive against timing windows during the creates).
      if (defaultPaymentMethod && session.customer) {
        try {
          await stripe.customers.update(session.customer as string, {
            invoice_settings: { default_payment_method: defaultPaymentMethod },
          });
        } catch (custErr) {
          console.warn('Could not re-set default pm on customer after service subs', custErr);
        }
      }
    }

    // Handle pre-created lease subscription (from the new lease flow where upfront is paid separately
    // via Checkout and the sub was created with trial_end so recurring monthly starts ~1 month later).
    // Attach the PM collected on the upfront payment to the customer and to the lease sub.
    if (session.customer && (metadata.is_lease_upfront || metadata.lease_subscription_id)) {
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
          console.warn('Could not expand payment_intent for lease upfront PM attach', retrieveErr);
        }
      }
      if (!defaultPaymentMethod && session.customer) {
        try {
          const pms = await stripe.customers.listPaymentMethods(session.customer as string, { limit: 5 });
          const recent = pms.data.find((p: any) => p.type === 'card' || p.type === 'sepa_debit');
          defaultPaymentMethod = recent?.id;
        } catch (listErr) {
          console.warn('Could not list PMs for lease upfront fallback', listErr);
        }
      }

      if (defaultPaymentMethod && session.customer) {
        try {
          await stripe.customers.update(session.customer as string, {
            invoice_settings: { default_payment_method: defaultPaymentMethod },
          });
        } catch (custErr) {
          console.warn('Could not set default pm on customer for lease upfront', custErr);
        }
      }

      const leaseSubId = metadata.lease_subscription_id;
      if (leaseSubId && defaultPaymentMethod) {
        try {
          await stripe.subscriptions.update(leaseSubId as string, {
            default_payment_method: defaultPaymentMethod,
          });
          console.log(`Attached PM ${defaultPaymentMethod} to pre-created lease sub ${leaseSubId} (from upfront payment)`);
        } catch (attachErr) {
          console.warn('Failed to attach PM to pre-created lease sub', attachErr);
        }
      }

      // Attach PM to pre-created lease service subs (created in the route before the upfront payment).
      if (metadata.lease_service_sub_ids) {
        let serviceSubIds: string[] = [];
        try {
          serviceSubIds = JSON.parse(metadata.lease_service_sub_ids);
        } catch {}
        for (const svcSubId of serviceSubIds) {
          if (defaultPaymentMethod) {
            try {
              await stripe.subscriptions.update(svcSubId, {
                default_payment_method: defaultPaymentMethod,
              });
              console.log(`Attached PM to pre-created lease service sub ${svcSubId} from upfront payment`);
            } catch (attachErr) {
              console.warn('Failed to attach PM to lease service sub', attachErr);
            }
          }
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
      if (invFinancing === 'full' || (invFinancing === 'lease' && invMeta.is_upfront_only)) {
        const isLeaseUpfront = invFinancing === 'lease' && invMeta.is_upfront_only;

        if (isLeaseUpfront) {
          // Create the recurring lease subscription now that the upfront has been paid.
          // Use trial_end so the first paid monthly starts ~1 month after this payment (the "initial payment").
          try {
            const hardwareMonthly = parseFloat(invMeta.lease_hardware_monthly_amount || invMeta.lease_monthly_amount || '0');
            const months = parseInt(invMeta.lease_months || '12');
            const cancelAt = parseInt(invMeta.lease_cancel_at || '0');
            const upfrontAmount = parseFloat(invMeta.lease_upfront_amount || '0');

            if (hardwareMonthly > 0 && cancelAt > 0) {
              const trialEnd = Math.floor(Date.now() / 1000) + 32 * 24 * 3600;
              const customerId = typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer as any)?.id;

              const leaseProduct = await stripe.products.create({
                name: 'NoCloud Appliance Lease (hardware)',
                description: `Monthly lease payment for hardware amortization over ${months} months. Recurring starts ~1 month after payment of upfront invoice ${invoice.id}. (Services on separate perpetual subscriptions.)`,
              });

              const sub = await stripe.subscriptions.create({
                customer: customerId,
                collection_method: 'send_invoice',
                days_until_due: 30,
                trial_end: trialEnd,
                items: [{
                  price_data: {
                    currency: 'eur',
                    product: leaseProduct.id,
                    unit_amount: Math.round(hardwareMonthly * 100),
                    recurring: { interval: 'month' },
                  },
                }],
                cancel_at: cancelAt,
                metadata: {
                  ...invMeta,
                  is_upfront_only: undefined, // not an upfront
                  is_recurring_lease_sub: 'true',
                  lease_upfront_invoice_paid: invoice.id,
                },
              });

              console.log(`Created lease recurring sub ${sub.id} on payment of upfront invoice ${invoice.id} (trial ends ~1 month after payment)`);

              // Also create separate perpetual service subs (no cancel_at, so they continue after lease term ends).
              // Use trial_end so they start ~1 month after this payment.
              let servicesArray: Array<{ name: string; price: number }> = [];
              try {
                if (invMeta.services) servicesArray = JSON.parse(invMeta.services);
              } catch {}
              console.log(`Lease paid for ${invoice.id}: creating ${servicesArray.length} service subs (perpetual, independent of lease term)`);
              for (const s of servicesArray) {
                try {
                  const serviceProduct = await stripe.products.create({ name: s.name });
                  const trialEnd = Math.floor(Date.now() / 1000) + 32 * 24 * 3600;
                  const svcSub = await stripe.subscriptions.create({
                    customer: customerId,
                    collection_method: 'send_invoice',
                    days_until_due: 30,
                    trial_end: trialEnd,
                    items: [{
                      price_data: {
                        currency: 'eur',
                        product: serviceProduct.id,
                        unit_amount: Math.round(s.price * 100),
                        recurring: { interval: 'month' },
                      },
                    }],
                    metadata: {
                      lease_upfront_invoice_paid: invoice.id,
                      service: s.name,
                      is_lease_service: 'true',
                    },
                  });
                  // Update the €0 trial draft for this service sub (disable auto finalization, good description).
                  const latestInv = (svcSub as any).latest_invoice;
                  if (latestInv) {
                    const invId = typeof latestInv === 'string' ? latestInv : latestInv.id;
                    if (invId) {
                      try {
                        const inv = typeof latestInv === 'string' || !latestInv.status ? await stripe.invoices.retrieve(invId) : latestInv;
                        if (inv.status === 'draft' || inv.status === 'open') {
                          await stripe.invoices.update(invId, {
                            auto_advance: false,
                            description: `Trial period for ${s.name} (lease service subscription ${svcSub.id}). Recurring payments for this service start after trial (~1 month after upfront payment ${invoice.id}). Services continue independently after the lease term ends.`,
                            footer: 'This service subscription continues after the lease hardware payments end.',
                          });
                          console.log(`Updated trial invoice for lease service sub ${svcSub.id}`);
                        }
                      } catch (updErr) {
                        console.warn('Could not update trial for lease service sub', updErr);
                      }
                    }
                  }
                  console.log(`Created lease service sub ${svcSub.id} for "${s.name}" on payment of ${invoice.id}`);
                } catch (svcErr) {
                  console.error('Failed to create lease service sub on upfront payment', svcErr);
                }
              }
            } else {
              console.warn('Missing lease details in meta for sub creation on upfront paid', invMeta);
            }
          } catch (subErr) {
            console.error('Failed to create lease sub on upfront payment', subErr);
          }
        }

        const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
        const customerEmail = invoice.customer_email || (invMeta as any).customer_email || '';
        const orderLocale = (invMeta.locale as string) || 'en';
        const isFr = orderLocale === 'fr';
        if (customerEmail && resend) {
          try {
            const subj = isFr
              ? `Paiement reçu — facture nocloud.ai #${invoice.id.slice(-8)}`
              : `Payment received — nocloud.ai invoice #${invoice.id.slice(-8)}`;
            const body = isLeaseUpfront
              ? (isFr
                  ? `Merci ! Votre acompte leasing (Net 30) a été payé. Le contrat de location a été activé ; les paiements mensuels récurrents commenceront dans environ 1 mois.`
                  : `Thank you! Your lease upfront (Net 30) has been paid. The lease subscription has been activated; recurring monthly payments will begin in approximately 1 month.`)
              : (isFr
                  ? 'Merci ! Votre paiement pour la facture Net 30 a été reçu.'
                  : 'Thank you! Your Net 30 invoice payment has been received.');
            await resend.emails.send({
              from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
              to: customerEmail,
              subject: subj,
              html: `
                <p>${body}</p>
                <p><strong>Invoice:</strong> ${invoice.id}</p>
                <p><strong>Amount:</strong> ${invoice.amount_paid ? (invoice.amount_paid / 100).toFixed(2) : '0.00'} ${(invoice.currency || 'eur').toUpperCase()}</p>
              `,
            });
          } catch (e) { console.error('Failed to send invoice paid email', e); }
        }
        if (process.env.ADMIN_EMAIL && resend) {
          try {
            const subj = isLeaseUpfront
              ? `Lease Upfront Invoice Paid (Net 30) - #${invoice.id.slice(-8)}`
              : `B2B Invoice Paid (Net 30) - #${invoice.id.slice(-8)}`;
            await resend.emails.send({
              from: 'orders@nocloud.ai <no-reply@nocloud.ai>',
              to: process.env.ADMIN_EMAIL,
              subject: subj,
              html: `<p>${isLeaseUpfront ? 'Lease upfront' : 'Net 30'} invoice ${invoice.id} has been paid by ${customerEmail || 'customer'}. ${isLeaseUpfront ? 'Recurring sub created with trial.' : ''}</p>`,
            });
          } catch (e) { console.error('Failed to send admin invoice paid email', e); }
        }
        console.log(`${isLeaseUpfront ? 'Lease upfront' : 'B2B pay-by-invoice'} paid: ${invoice.id}`);
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

    // Additive fallback (list recent PM) for cases where the initial paid invoice's PI does not surface the method (e.g. some SEPA flows or edge timing).
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
      try {
        await stripe.customers.update(sub.customer as string, {
          invoice_settings: { default_payment_method: defaultPaymentMethod },
        });
        await stripe.subscriptions.update(sub.id, {
          default_payment_method: defaultPaymentMethod,
        });
        console.log(`Attached default PM ${defaultPaymentMethod} to lease customer/sub ${sub.id} for future recurring cycles`);
      } catch (attachErr) {
        console.warn('Failed to set explicit default_payment_method on lease customer/sub (future cycles may still work via hosted payment side-effects)', attachErr);
      }
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
    let servicesArray: Array<{ name: string; price: number }> = [];
    try {
      if (metadata.services) {
        servicesArray = JSON.parse(metadata.services);
        servicesStr = servicesArray.map(s => `${s.name} (€${s.price}/mo)`).join(', ') || 'None';
      }
    } catch {}

    const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

    // Customer email
    if (customerEmail && resend) {
      const leaseNote = `<p><strong>Lease term:</strong> ${leaseMonths || '?'} months</p>`;
      const upfront = (metadata as any).lease_upfront_amount;
      const upfrontNote = upfront ? `<p><strong>Upfront payment:</strong> €${upfront}</p>` : '';
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
            ${upfrontNote}
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
        console.error('Failed to send customer email for lease order', orderId, emailErr);
      }
    }

    // Admin notification for lease invoice payment
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
            ${(metadata as any).lease_upfront_amount ? `<p><strong>Upfront payment:</strong> €${(metadata as any).lease_upfront_amount}</p>` : ''}
            <p><strong>Services:</strong> ${servicesStr}</p>
            <p><strong>Company:</strong> ${companyName}</p>
            <p><strong>VAT:</strong> ${vatNumber}</p>
            <p><strong>PO #:</strong> ${poNumber}</p>
            <p><strong>Subscription ID:</strong> ${sub.id}</p>
            <p><strong>Invoice ID:</strong> ${invoice.id}</p>
            <p><strong>Pricing version:</strong> ${pricingVersion}</p>
            <p>${adminCheck}</p>
          `,
        });
      } catch (emailErr) {
        console.error('Failed to send admin email for lease order', orderId, emailErr);
      }
    }

    console.log(`Lease order paid (invoice): ${orderId} (sub ${sub.id})`);
  }

  return NextResponse.json({ received: true });
}
