import { Resend } from 'resend';
import { BRAND_DISPLAY, getBrandEmail } from './brand';

export function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  return new Resend(process.env.RESEND_API_KEY);
}

export interface RegisteredInvoiceEmailParams {
  to: string;
  invoiceId: string;
  company: string;
  emailFallback?: string; // for admin
  locale?: string;
  isHybridRecurring?: boolean;
  recurringPaymentMethod?: string;
  setupSessionId?: string;
  isLeaseUpfront?: boolean;
}

export interface OrderConfirmationParams {
  to: string;
  orderId: string; // session id or invoice id
  amount: string;
  currency: string;
  financing: string;
  leaseMonths?: string;
  upfrontAmount?: string;
  servicesStr: string;
  hardwareStr?: string;
  companyName: string;
  vatNumber: string;
  poNumber: string;
  pricingVersion: string;
  locale?: string;
  isLeaseInvoicePaid?: boolean; // affects some labels
}

export interface AdminNotificationParams {
  orderId: string;
  amount?: string;
  currency?: string;
  financing: string;
  leaseMonths?: string;
  upfrontAmount?: string;
  servicesStr: string;
  hardwareStr?: string;
  companyName: string;
  vatNumber: string;
  poNumber: string;
  pricingVersion: string;
  locale?: string;
  customerEmail?: string;
  isLeaseInvoicePaid?: boolean;
  subscriptionId?: string;
  invoiceId?: string;
  setupSessionId?: string;
  isHybrid?: boolean;
  recurringPaymentMethod?: string;
  isPaidNotification?: boolean; // for paid vs registered
}

/**
 * Customer "registered / you will receive the invoice shortly" email.
 * Used by checkout route for invoice and lease-upfront paths (before payment).
 */
export async function sendRegisteredInvoiceCustomerEmail(
  params: RegisteredInvoiceEmailParams
) {
  const resend = getResendClient();
  if (!resend || !params.to) return;

  const { invoiceId, company, locale = 'en', isHybridRecurring, recurringPaymentMethod, setupSessionId, isLeaseUpfront } = params;
  const shortId = invoiceId.slice(-8);
  const isFr = locale === 'fr';

  let subj: string;
  let body: string;

  if (isLeaseUpfront) {
    subj = isFr
      ? `Merci pour votre commande ${BRAND_DISPLAY} #${shortId} (acompte leasing)`
      : `Thank you for your ${BRAND_DISPLAY} order #${shortId} (lease upfront)`;
    body = isFr
      ? `Votre acompte leasing a été enregistré (Net 30). Le contrat de location (paiements mensuels récurrents) sera activé au paiement de cette facture ; les paiements récurrents commenceront dans environ 1 mois après le paiement.`
      : `Your lease upfront has been registered (Net 30). The lease subscription (recurring monthly payments) will be activated upon payment of this invoice; recurring payments will begin approximately 1 month after payment.`;
  } else if (isHybridRecurring) {
    subj = isFr
      ? `Merci pour votre commande ${BRAND_DISPLAY} #${shortId}`
      : `Thank you for your ${BRAND_DISPLAY} order #${shortId}`;
    body = isFr
      ? `Votre commande a été enregistrée. Vous recevrez sous peu une facture avec les instructions de paiement (Net 30) pour le matériel. Veuillez également finaliser la méthode de paiement pour les services récurrents sur la page de configuration Stripe.`
      : `Your order has been registered. You will receive an invoice with payment instructions shortly (Net 30) for the hardware. Please also complete the payment method setup for recurring services on the Stripe page.`;
  } else {
    subj = isFr
      ? `Merci pour votre commande ${BRAND_DISPLAY} #${shortId}`
      : `Thank you for your ${BRAND_DISPLAY} order #${shortId}`;
    body = isFr
      ? `Votre commande a été enregistrée. Vous recevrez sous peu une facture avec les instructions de paiement (Net 30).`
      : `Your order has been registered. You will receive an invoice with payment instructions shortly (Net 30).`;
  }

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.to,
      subject: subj,
      html: `
        <h1 style="color: #0ea5e9;">${isFr ? 'Merci pour votre achat !' : 'Thank you for your purchase!'}</h1>
        <p>${body}</p>
        <p><strong>Order ID:</strong> ${invoiceId}</p>
        <p><strong>Company:</strong> ${company || 'N/A'}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send invoice registered email', e);
  }
}

/**
 * Admin notification for a newly created (registered) B2B invoice / lease upfront.
 */
export async function sendAdminInvoiceRegisteredEmail(params: RegisteredInvoiceEmailParams & { isHybrid?: boolean; recurringPaymentMethod?: string; setupSessionId?: string }) {
  const resend = getResendClient();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!resend || !adminEmail) return;

  const { invoiceId, company, emailFallback, isHybrid, recurringPaymentMethod, setupSessionId, isLeaseUpfront } = params;
  const shortId = invoiceId.slice(-8);

  let subject: string;
  let html: string;

  if (isLeaseUpfront) {
    subject = `New Lease Upfront (Net 30) - #${shortId}`;
    html = `<p>New lease upfront invoice for ${company || emailFallback}. Invoice ${invoiceId}. Recurring sub will be created on payment (monthly starts ~1 month after payment).</p>`;
  } else if (isHybrid) {
    subject = `New B2B Invoice (Net 30) + Recurring Setup - #${shortId}`;
    html = `<p>New hybrid Pay by Invoice order for ${company || emailFallback}. Invoice ${invoiceId} created and sent (Net 30 for hardware). Setup session ${setupSessionId} created for recurring services (${recurringPaymentMethod}).</p>`;
  } else {
    subject = `New B2B Invoice (Net 30) - #${shortId}`;
    html = `<p>New Pay by Invoice order for ${company || emailFallback}. Invoice ${invoiceId} created and sent (Net 30).</p>`;
  }

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: adminEmail,
      subject,
      html,
    });
  } catch (e) {
    console.error('Failed to send admin invoice email', e);
  }
}

/**
 * Rich customer confirmation email sent on checkout.session.completed (or equivalent lease paid).
 * Skips for certain hybrid setup flows (caller decides).
 */
export async function sendOrderConfirmationCustomerEmail(params: OrderConfirmationParams) {
  const resend = getResendClient();
  if (!resend || !params.to) return;

  const {
    orderId,
    amount,
    currency,
    financing,
    leaseMonths,
    upfrontAmount,
    servicesStr,
    hardwareStr,
    companyName,
    vatNumber,
    poNumber,
    pricingVersion,
    locale = 'en',
    isLeaseInvoicePaid,
  } = params;

  const isFr = locale === 'fr';
  const shortId = orderId.slice(-8);

  const thanksSubj = isFr
    ? `Merci pour votre commande nocloud.ai #${shortId}`
    : `Thank you for your nocloud.ai order #${shortId}`;
  const thanksTitle = isFr ? 'Merci pour votre achat !' : 'Thank you for your purchase!';
  const thanksBody = isFr ? 'Votre commande a été reçue et le paiement confirmé.' : 'Your order has been received and payment confirmed.';
  const thanksSummary = isFr ? 'Récapitulatif de commande' : 'Order Summary';
  const thanksServices = isFr ? 'Services optionnels' : 'Optional Services';
  const thanksHardware = isFr ? 'Configuration matériel' : 'Hardware configuration';
  const thanksCompany = isFr ? 'Société' : 'Company';
  const thanksVat = isFr ? 'Numéro de TVA' : 'VAT Number';
  const thanksPo = isFr ? 'N° de commande' : 'PO Number';
  const thanksPriceVer = isFr ? 'Version de tarification' : 'Pricing version';
  const thanksFooter = isFr ? 'Vous recevrez l\'appareil prochainement. Contactez-nous si vous avez des questions.' : 'You will receive the appliance soon. Contact us if you have any questions.';
  const thanksClose = isFr ? `Cordialement,<br>L'équipe ${BRAND_DISPLAY}` : `Best regards,<br>The ${BRAND_DISPLAY} Team`;
  const adminHardwareLine = hardwareStr ? `<p><strong>Hardware:</strong> ${hardwareStr}</p>` : '';

  const leaseNote = financing === 'lease' ? `<p><strong>Lease term:</strong> ${leaseMonths || '?'} months</p>` : '';
  const upfront = upfrontAmount;
  const upfrontNote = (financing === 'lease' && upfront) || (isLeaseInvoicePaid && upfront)
    ? `<p><strong>Upfront payment:</strong> €${upfront}</p>` : '';

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.to,
      subject: thanksSubj,
      html: `
        <h1 style="color: #0ea5e9;">${thanksTitle}</h1>
        <p>${thanksBody}</p>
        <h2>${thanksSummary}</h2>
        <p><strong>Total:</strong> ${amount} ${currency}</p>
        <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
        ${upfrontNote}
        <p><strong>${thanksServices}:</strong> ${servicesStr}</p>
        ${hardwareStr ? `<p><strong>${thanksHardware}:</strong> ${hardwareStr}</p>` : ''}
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

/**
 * Admin "new order received" notification (used for both session.completed and final lease paid).
 */
export async function sendAdminOrderNotificationEmail(params: AdminNotificationParams) {
  const resend = getResendClient();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!resend || !adminEmail) return;

  const {
    orderId,
    amount = '0.00',
    currency = 'EUR',
    financing,
    leaseMonths,
    upfrontAmount,
    servicesStr,
    hardwareStr,
    companyName,
    vatNumber,
    poNumber,
    pricingVersion,
    locale = 'en',
    customerEmail,
    isLeaseInvoicePaid,
    subscriptionId,
    invoiceId,
    setupSessionId,
    isHybrid,
    recurringPaymentMethod,
    isPaidNotification,
  } = params;

  const isFr = locale === 'fr';
  const shortId = orderId.slice(-8);

  if (isPaidNotification) {
    // Simpler paid notifications (used for invoice.paid non-lease and lease upfront paid)
    const subj = isLeaseInvoicePaid
      ? `Lease Upfront Invoice Paid (Net 30) - #${shortId}`
      : `B2B Invoice Paid (Net 30) - #${shortId}`;
    const html = `<p>${isLeaseInvoicePaid ? 'Lease upfront' : 'Net 30'} invoice ${invoiceId || orderId} has been paid by ${customerEmail || 'customer'}. ${isLeaseInvoicePaid ? 'Recurring sub created with trial.' : ''}</p>`;
    try {
      await resend.emails.send({
        from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
        to: adminEmail,
        subject: subj,
        html,
      });
    } catch (e) {
      console.error('Failed to send admin invoice paid email', e);
    }
    return;
  }

  const adminSubj = isFr
    ? `Nouvelle commande B2B sur ${BRAND_DISPLAY} - #${shortId}`
    : `New Order Received - #${shortId}`;
  const adminTitle = isFr ? `Nouvelle commande B2B sur ${BRAND_DISPLAY}` : `New B2B Order on ${BRAND_DISPLAY}`;
  const adminCheck = isFr ? 'Vérifiez le tableau de bord Stripe pour tous les détails et pour exécuter la commande.' : 'Check Stripe dashboard for full details and fulfill the order.';

  let extra = '';
  if (isHybrid && setupSessionId) {
    extra = `<p>Hybrid recurring setup: ${setupSessionId} (${recurringPaymentMethod})</p>`;
  }

  const adminHardwareLine = hardwareStr ? `<p><strong>Hardware:</strong> ${hardwareStr}</p>` : '';

  const html = `
    <h2>${adminTitle}</h2>
    <p><strong>Customer Email:</strong> ${customerEmail || 'N/A'}</p>
    <p><strong>Total Paid:</strong> ${amount} ${currency}</p>
    <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
    ${(financing === 'lease' && upfrontAmount) || (isLeaseInvoicePaid && upfrontAmount) ? `<p><strong>Upfront payment:</strong> €${upfrontAmount}</p>` : ''}
    <p><strong>Services:</strong> ${servicesStr}</p>
    ${adminHardwareLine}
    <p><strong>Company:</strong> ${companyName}</p>
    <p><strong>VAT:</strong> ${vatNumber}</p>
    <p><strong>PO #:</strong> ${poNumber}</p>
    <p><strong>Full Session ID:</strong> ${orderId}</p>
    ${subscriptionId ? `<p><strong>Subscription ID:</strong> ${subscriptionId}</p>` : ''}
    ${invoiceId ? `<p><strong>Invoice ID:</strong> ${invoiceId}</p>` : ''}
    <p><strong>Pricing version:</strong> ${pricingVersion}</p>
    ${extra}
    <p>${adminCheck}</p>
  `;

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: adminEmail,
      subject: adminSubj,
      html,
    });
  } catch (emailErr) {
    console.error('Failed to send admin email for order', orderId, emailErr);
  }
}

/**
 * Simple "payment received" email for actual paid Net30 / lease upfront invoices.
 */
export async function sendInvoicePaidCustomerEmail(params: {
  to: string;
  invoiceId: string;
  amountPaid: string;
  currency: string;
  locale?: string;
  isLeaseUpfront?: boolean;
}) {
  const resend = getResendClient();
  if (!resend || !params.to) return;

  const { invoiceId, amountPaid, currency, locale = 'en', isLeaseUpfront } = params;
  const isFr = locale === 'fr';
  const shortId = invoiceId.slice(-8);

  const subj = isFr
    ? `Paiement reçu — facture ${BRAND_DISPLAY} #${shortId}`
    : `Payment received — ${BRAND_DISPLAY} invoice #${shortId}`;

  const body = isLeaseUpfront
    ? (isFr
        ? `Merci ! Votre acompte leasing (Net 30) a été payé. Le contrat de location a été activé ; les paiements mensuels récurrents commenceront dans environ 1 mois.`
        : `Thank you! Your lease upfront (Net 30) has been paid. The lease subscription has been activated; recurring monthly payments will begin in approximately 1 month.`)
    : (isFr
        ? 'Merci ! Votre paiement pour la facture Net 30 a été reçu.'
        : 'Thank you! Your Net 30 invoice payment has been received.');

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.to,
      subject: subj,
      html: `
        <p>${body}</p>
        <p><strong>Invoice:</strong> ${invoiceId}</p>
        <p><strong>Amount:</strong> ${amountPaid} ${currency}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send invoice paid email', e);
  }
}
