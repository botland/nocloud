import { Resend } from 'resend';
import { BRAND_DISPLAY, getBrandEmail } from './brand';

function formatPrice(amount: number | string, locale?: string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (locale === 'fr') return `${num}€`;
  return `€${num}`;
}

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
  // VAT choice / treatment (for breakdown + legal text in emails)
  vatInclusive?: boolean;
  vatTreatment?: string;
  vatRate?: number;
  netTotal?: number;
  vatAmount?: number;
  grossTotal?: number;
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
  /** Pre-order deposit confirmation (commerce mode preorder). */
  isPreorderDeposit?: boolean;
  balanceDue?: string;
  quotedHardwareTotal?: string;
  // VAT choice / treatment (for breakdown + legal text in emails)
  vatInclusive?: boolean;
  vatTreatment?: string;
  vatRate?: number;
  netTotal?: number;
  vatAmount?: number;
  grossTotal?: number;
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
  isPaidNotification?: boolean; // deprecated — detailed admin emails are sent only on successful payment
  orderType?: string;
  preorderStatus?: string;
  depositAmount?: string;
  balanceDue?: string;
  quotedTotal?: string;
  priceLockPolicy?: string;
  fulfillmentAction?: string;
  // VAT choice / treatment (for breakdown + legal text in emails)
  vatInclusive?: boolean;
  vatTreatment?: string;
  vatRate?: number;
  netTotal?: number;
  vatAmount?: number;
  grossTotal?: number;
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

  const { invoiceId, company, locale = 'en', isHybridRecurring, recurringPaymentMethod, setupSessionId, isLeaseUpfront, vatInclusive, vatTreatment, vatRate, netTotal, vatAmount, grossTotal } = params;
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
        ${netTotal != null ? `
          <p><strong>VAT treatment:</strong> ${vatTreatment || (vatInclusive ? 'VAT-inclusive (customer choice)' : 'Standard / reverse charge')}</p>
          <p><strong>Net:</strong> ${formatPrice(netTotal, locale)} ${vatAmount != null && vatAmount > 0 ? `+ VAT ${formatPrice(vatAmount, locale)} (${Math.round((vatRate||0)*100)}%)` : ''} = <strong>${formatPrice(grossTotal != null ? grossTotal : netTotal, locale)}</strong></p>
        ` : ''}
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

  const { invoiceId, company, emailFallback, isHybrid, recurringPaymentMethod, setupSessionId, isLeaseUpfront, vatTreatment, netTotal, vatAmount, grossTotal, vatInclusive } = params;
  const shortId = invoiceId.slice(-8);

  let subject: string;
  let html: string;

  if (isLeaseUpfront) {
    subject = `New Lease Upfront (Net 30) - #${shortId}`;
    html = `<p>New lease upfront invoice for ${company || emailFallback}. Invoice ${invoiceId}. Recurring sub will be created on payment (monthly starts ~1 month after payment).${netTotal != null ? ` VAT: ${vatTreatment || ''} net=${netTotal} vat=${vatAmount||0} gross=${grossTotal||netTotal}` : ''}</p>`;
  } else if (isHybrid) {
    subject = `New B2B Invoice (Net 30) + Recurring Setup - #${shortId}`;
    html = `<p>New hybrid Pay by Invoice order for ${company || emailFallback}. Invoice ${invoiceId} created and sent (Net 30 for hardware). Setup session ${setupSessionId} created for recurring services (${recurringPaymentMethod}).${netTotal != null ? ` VAT info: net=${netTotal} vat=${vatAmount||0} gross=${grossTotal||netTotal} choice=${vatInclusive}` : ''}</p>`;
  } else {
    subject = `New B2B Invoice (Net 30) - #${shortId}`;
    html = `<p>New Pay by Invoice order for ${company || emailFallback}. Invoice ${invoiceId} created and sent (Net 30).${netTotal != null ? ` VAT: ${vatTreatment || ''} net=${netTotal} vat=${vatAmount||0} gross=${grossTotal||netTotal}` : ''}</p>`;
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
    isPreorderDeposit,
    balanceDue,
    quotedHardwareTotal,
    vatInclusive,
    vatTreatment,
    vatRate,
    netTotal,
    vatAmount,
    grossTotal,
  } = params;

  const isFr = locale === 'fr';
  const shortId = orderId.slice(-8);

  const thanksSubj = isPreorderDeposit
    ? (isFr ? `Précommande confirmée — ${BRAND_DISPLAY} #${shortId}` : `Pre-order confirmed — ${BRAND_DISPLAY} #${shortId}`)
    : (isFr ? `Merci pour votre commande nocloud.ai #${shortId}` : `Thank you for your nocloud.ai order #${shortId}`);
  const thanksTitle = isPreorderDeposit
    ? (isFr ? 'Merci — votre précommande est confirmée' : 'Thank you — your pre-order is confirmed')
    : (isFr ? 'Merci pour votre achat !' : 'Thank you for your purchase!');
  const thanksBody = isPreorderDeposit
    ? (isFr
        ? `Votre acompte a été reçu. Le solde de ${balanceDue || '?'} € sera prélevé sur le même moyen de paiement lorsque votre appareil sera prêt à expédier.`
        : `Your deposit has been received. The remaining balance of €${balanceDue || '?'} will be charged to the same payment method when your appliance is ready to ship.`)
    : (isFr ? 'Votre commande a été reçue et le paiement confirmé.' : 'Your order has been received and payment confirmed.');
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
    ? `<p><strong>Upfront payment:</strong> ${formatPrice(upfront, locale)}</p>` : '';

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.to,
      subject: thanksSubj,
      html: `
        <h1 style="color: #0ea5e9;">${thanksTitle}</h1>
        <p>${thanksBody}</p>
        <h2>${thanksSummary}</h2>
        <p><strong>${isPreorderDeposit ? (isFr ? 'Acompte payé' : 'Deposit paid') : 'Total'}:</strong> ${amount} ${currency}</p>
        ${isPreorderDeposit && quotedHardwareTotal ? `<p><strong>${isFr ? 'Total matériel réservé' : 'Reserved hardware total'}:</strong> ${formatPrice(quotedHardwareTotal, locale)}</p>` : ''}
        ${isPreorderDeposit && balanceDue ? `<p><strong>${isFr ? 'Solde à l\'expédition' : 'Balance due at ship'}:</strong> ${formatPrice(balanceDue, locale)}</p>` : ''}
        ${!isPreorderDeposit ? `<p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>` : ''}
        ${upfrontNote}
        <p><strong>${thanksServices}:</strong> ${servicesStr}</p>
        ${hardwareStr ? `<p><strong>${thanksHardware}:</strong> ${hardwareStr}</p>` : ''}
        <p><strong>${thanksCompany}:</strong> ${companyName}</p>
        <p><strong>${thanksVat}:</strong> ${vatNumber}</p>
        <p><strong>${thanksPo}:</strong> ${poNumber}</p>
        <p>Order ID: ${orderId}</p>
        <p><strong>${thanksPriceVer}:</strong> ${pricingVersion}</p>
        ${leaseNote}
        ${netTotal != null ? `<p><strong>VAT:</strong> ${vatTreatment || (vatInclusive ? 'inclusive (elected)' : 'standard / RC')} — net ${formatPrice(netTotal, locale)}${vatAmount != null && vatAmount > 0 ? ` + ${formatPrice(vatAmount, locale)} @ ${Math.round((vatRate||0)*100)}%` : ''} = ${formatPrice(grossTotal != null ? grossTotal : netTotal, locale)}</p>` : ''}
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
    vatInclusive,
    vatTreatment,
    vatRate,
    netTotal,
    vatAmount,
    grossTotal,
    invoiceId,
    setupSessionId,
    isHybrid,
    recurringPaymentMethod,
    isPaidNotification: _isPaidNotification,
    orderType,
    preorderStatus,
    depositAmount,
    balanceDue,
    quotedTotal,
    priceLockPolicy,
    fulfillmentAction,
  } = params;

  const isFr = locale === 'fr';
  const shortId = orderId.slice(-8);
  const isPreorder = orderType === 'preorder';

  const adminSubj = isPreorder
    ? (isFr ? `Précommande payée — ${BRAND_DISPLAY} #${shortId}` : `Pre-order paid — ${BRAND_DISPLAY} #${shortId}`)
    : (isFr ? `Nouvelle commande B2B sur ${BRAND_DISPLAY} - #${shortId}` : `New Order Received - #${shortId}`);
  const adminTitle = isPreorder
    ? (isFr ? `Précommande confirmée sur ${BRAND_DISPLAY}` : `Pre-order confirmed on ${BRAND_DISPLAY}`)
    : (isFr ? `Nouvelle commande B2B sur ${BRAND_DISPLAY}` : `New B2B Order on ${BRAND_DISPLAY}`);
  const adminCheck = isFr ? 'Vérifiez le tableau de bord Stripe pour tous les détails et pour exécuter la commande.' : 'Check Stripe dashboard for full details and fulfill the order.';

  let extra = '';
  if (isHybrid && setupSessionId) {
    extra = `<p>Hybrid recurring setup: ${setupSessionId} (${recurringPaymentMethod})</p>`;
  }

  const adminHardwareLine = hardwareStr ? `<p><strong>Hardware:</strong> ${hardwareStr}</p>` : '';
  const preorderLines = isPreorder ? `
    <p><strong>Order type:</strong> pre-order</p>
    ${preorderStatus ? `<p><strong>Pre-order status:</strong> ${preorderStatus}</p>` : ''}
    ${depositAmount ? `<p><strong>Deposit paid:</strong> ${formatPrice(depositAmount, locale)}</p>` : ''}
    ${balanceDue ? `<p><strong>Balance due at ship:</strong> ${formatPrice(balanceDue, locale)}</p>` : ''}
    ${quotedTotal ? `<p><strong>Quoted hardware total:</strong> ${formatPrice(quotedTotal, locale)}</p>` : ''}
    ${priceLockPolicy ? `<p><strong>Price lock:</strong> ${priceLockPolicy}</p>` : ''}
    ${fulfillmentAction ? `<p><strong>Fulfillment action:</strong> ${fulfillmentAction}</p>` : ''}
  ` : '';

  const html = `
    <h2>${adminTitle}</h2>
    <p><strong>Customer Email:</strong> ${customerEmail || 'N/A'}</p>
    <p><strong>${isPreorder ? 'Deposit paid' : 'Total Paid'}:</strong> ${amount} ${currency}</p>
    ${preorderLines}
    <p><strong>Financing:</strong> ${financing}${leaseMonths ? ` (${leaseMonths} months)` : ''}</p>
    ${(financing === 'lease' && upfrontAmount) || (isLeaseInvoicePaid && upfrontAmount) ? `<p><strong>Upfront payment:</strong> ${formatPrice(upfrontAmount, locale)}</p>` : ''}
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
    ${netTotal != null ? `<p><strong>VAT treatment:</strong> ${vatTreatment || (vatInclusive ? 'inclusive' : 'standard/RC')} net ${formatPrice(netTotal, locale)} vat ${formatPrice(vatAmount||0, locale)} gross ${formatPrice(grossTotal||netTotal, locale)}</p>` : ''}
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
  // VAT fields (optional for backward compat with older orders)
  vatInclusive?: boolean;
  vatTreatment?: string;
  vatRate?: number;
  netTotal?: number;
  vatAmount?: number;
  grossTotal?: number;
}) {
  const resend = getResendClient();
  if (!resend || !params.to) return;

  const { invoiceId, amountPaid, currency, locale = 'en', isLeaseUpfront, vatInclusive, vatTreatment, vatRate, netTotal, vatAmount, grossTotal } = params;
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
        ${netTotal != null ? `<p><strong>VAT:</strong> ${vatTreatment || (vatInclusive ? 'incl' : 'std')} net ${formatPrice(netTotal, locale)} vat ${formatPrice(vatAmount||0, locale)} gross ${formatPrice(grossTotal||netTotal, locale)}</p>` : ''}
      `,
    });
  } catch (e) {
    console.error('Failed to send invoice paid email', e);
  }
}

export interface BalancePaymentRequiredParams {
  to: string;
  invoiceId: string;
  hostedInvoiceUrl: string;
  balanceAmount: string;
  currency?: string;
  failureReason: string;
  hardwareStr?: string;
  companyName?: string;
  locale?: string;
  depositSessionId?: string;
}

/**
 * Customer email when balance auto-charge fails and a Net-30 invoice is sent (Tier 2).
 */
export async function sendBalancePaymentRequiredEmail(params: BalancePaymentRequiredParams) {
  const resend = getResendClient();
  if (!resend || !params.to) return;

  const {
    invoiceId,
    hostedInvoiceUrl,
    balanceAmount,
    currency = 'EUR',
    failureReason,
    hardwareStr,
    companyName,
    locale = 'en',
    depositSessionId,
  } = params;
  const isFr = locale === 'fr';
  const shortId = invoiceId.slice(-8);

  const subj = isFr
    ? `Solde à régler — ${BRAND_DISPLAY} #${shortId}`
    : `Balance payment required — ${BRAND_DISPLAY} #${shortId}`;

  const body = isFr
    ? `Le prélèvement automatique du solde n'a pas pu être effectué. Veuillez régler le solde de ${balanceAmount} ${currency} via le lien de facture ci-dessous.`
    : `We could not charge the remaining balance automatically. Please pay ${balanceAmount} ${currency} using the invoice link below.`;

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.to,
      subject: subj,
      html: `
        <h1 style="color: #0ea5e9;">${isFr ? 'Solde de précommande à régler' : 'Pre-order balance due'}</h1>
        <p>${body}</p>
        <p><strong>${isFr ? 'Motif' : 'Reason'}:</strong> ${failureReason}</p>
        ${hardwareStr ? `<p><strong>${isFr ? 'Appareil(s)' : 'Appliance(s)'}:</strong> ${hardwareStr}</p>` : ''}
        ${companyName ? `<p><strong>${isFr ? 'Société' : 'Company'}:</strong> ${companyName}</p>` : ''}
        <p><strong>${isFr ? 'Montant du solde' : 'Balance amount'}:</strong> ${balanceAmount} ${currency}</p>
        <p><a href="${hostedInvoiceUrl}" style="color:#0ea5e9;">${isFr ? 'Payer la facture' : 'Pay invoice'}</a></p>
        <p>Invoice ID: ${invoiceId}</p>
        ${depositSessionId ? `<p>Deposit session: ${depositSessionId}</p>` : ''}
      `,
    });
  } catch (e) {
    console.error('Failed to send balance payment required email', e);
  }
}

export interface RecurringDunningEmailParams {
  customerEmail: string;
  serviceName: string;
  hostSerialNumber?: string;
  failureReason: string;
  portalUrl: string;
  locale?: string;
  subscriptionId: string;
  cancelDays?: number;
}

export async function sendRecurringPaymentFailedEmail(params: RecurringDunningEmailParams) {
  const resend = getResendClient();
  if (!resend || !params.customerEmail) return;

  const { serviceName, hostSerialNumber, failureReason, portalUrl, locale = 'en', subscriptionId } = params;
  const isFr = locale === 'fr';
  const snLine = hostSerialNumber
    ? (isFr ? ` (appareil S/N ${hostSerialNumber})` : ` (appliance S/N ${hostSerialNumber})`)
    : '';

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.customerEmail,
      subject: isFr
        ? `Échec du paiement récurrent — ${serviceName}`
        : `Recurring payment failed — ${serviceName}`,
      html: `
        <h1 style="color: #0ea5e9;">${isFr ? 'Paiement de service échoué' : 'Service payment failed'}</h1>
        <p>${isFr ? 'Le paiement mensuel pour' : 'Your monthly payment for'} <strong>${serviceName}</strong>${snLine} ${isFr ? 'a échoué.' : 'failed.'}</p>
        <p><strong>${isFr ? 'Motif' : 'Reason'}:</strong> ${failureReason}</p>
        <p>${isFr ? 'Veuillez mettre à jour votre moyen de paiement via le portail sécurisé Stripe :' : 'Please update your payment method via the secure Stripe portal:'}</p>
        <p><a href="${portalUrl}" style="color:#0ea5e9;">${isFr ? 'Mettre à jour le moyen de paiement' : 'Update payment method'}</a></p>
        <p>Subscription: ${subscriptionId}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send recurring payment failed email', e);
  }
}

export async function sendRecurringPaymentWarningEmail(params: RecurringDunningEmailParams) {
  const resend = getResendClient();
  if (!resend || !params.customerEmail) return;

  const { serviceName, hostSerialNumber, failureReason, portalUrl, locale = 'en', subscriptionId, cancelDays = 14 } = params;
  const isFr = locale === 'fr';
  const snLine = hostSerialNumber
    ? (isFr ? ` (appareil S/N ${hostSerialNumber})` : ` (appliance S/N ${hostSerialNumber})`)
    : '';

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.customerEmail,
      subject: isFr
        ? `Rappel — mettez à jour votre moyen de paiement (${serviceName})`
        : `Reminder — update your payment method (${serviceName})`,
      html: `
        <h1 style="color: #f59e0b;">${isFr ? 'Action requise' : 'Action required'}</h1>
        <p>${isFr ? 'Votre paiement récurrent pour' : 'Your recurring payment for'} <strong>${serviceName}</strong>${snLine} ${isFr ? 'reste en échec.' : 'is still failing.'}</p>
        <p><strong>${isFr ? 'Motif' : 'Reason'}:</strong> ${failureReason}</p>
        <p>${isFr
          ? `Si le moyen de paiement n'est pas mis à jour, l'abonnement sera annulé dans environ ${cancelDays} jours après le premier échec.`
          : `If your payment method is not updated, this subscription will be cancelled approximately ${cancelDays} days after the first failure.`}</p>
        <p><a href="${portalUrl}" style="color:#0ea5e9;">${isFr ? 'Mettre à jour le moyen de paiement' : 'Update payment method'}</a></p>
        <p>Subscription: ${subscriptionId}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send recurring payment warning email', e);
  }
}

export async function sendRecurringPaymentCancelledEmail(params: RecurringDunningEmailParams) {
  const resend = getResendClient();
  if (!resend || !params.customerEmail) return;

  const { serviceName, hostSerialNumber, locale = 'en', subscriptionId } = params;
  const isFr = locale === 'fr';
  const snLine = hostSerialNumber
    ? (isFr ? ` pour l'appareil S/N ${hostSerialNumber}` : ` for appliance S/N ${hostSerialNumber}`)
    : '';

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: params.customerEmail,
      subject: isFr
        ? `Abonnement annulé — ${serviceName}`
        : `Subscription cancelled — ${serviceName}`,
      html: `
        <h1>${isFr ? 'Abonnement annulé' : 'Subscription cancelled'}</h1>
        <p>${isFr ? 'Votre abonnement' : 'Your subscription to'} <strong>${serviceName}</strong>${snLine} ${isFr ? 'a été annulé suite à des échecs de paiement répétés.' : 'has been cancelled due to repeated payment failures.'}</p>
        <p>${isFr ? 'Contactez-nous pour réactiver les services sur cet appareil.' : 'Contact us to re-subscribe services for this appliance.'}</p>
        <p>Subscription: ${subscriptionId}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send recurring payment cancelled email', e);
  }
}

export async function sendAdminRecurringPaymentFailureEmail(params: RecurringDunningEmailParams) {
  const resend = getResendClient();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!resend || !adminEmail) return;

  const { serviceName, hostSerialNumber, failureReason, portalUrl, customerEmail, subscriptionId } = params;

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: adminEmail,
      subject: `Recurring payment failed — ${serviceName} (${subscriptionId.slice(-8)})`,
      html: `
        <p>Recurring service payment failed (commerce-mode agnostic — applies to preorder and live orders).</p>
        <p><strong>Customer:</strong> ${customerEmail || 'N/A'}</p>
        <p><strong>Service:</strong> ${serviceName}</p>
        ${hostSerialNumber ? `<p><strong>Appliance S/N:</strong> ${hostSerialNumber}</p>` : ''}
        <p><strong>Reason:</strong> ${failureReason}</p>
        <p><strong>Portal link sent:</strong> <a href="${portalUrl}">${portalUrl}</a></p>
        <p><strong>Subscription:</strong> ${subscriptionId}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send admin recurring failure email', e);
  }
}

export async function sendAdminRecurringPaymentCancelledEmail(params: RecurringDunningEmailParams) {
  const resend = getResendClient();
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!resend || !adminEmail) return;

  const { serviceName, hostSerialNumber, customerEmail, subscriptionId } = params;

  try {
    await resend.emails.send({
      from: `${getBrandEmail('orders')} <${getBrandEmail('no-reply')}>`,
      to: adminEmail,
      subject: `Recurring subscription cancelled — ${serviceName} (${subscriptionId.slice(-8)})`,
      html: `
        <p>Service subscription cancelled after dunning period elapsed.</p>
        <p><strong>Customer:</strong> ${customerEmail || 'N/A'}</p>
        <p><strong>Service:</strong> ${serviceName}</p>
        ${hostSerialNumber ? `<p><strong>Appliance S/N:</strong> ${hostSerialNumber}</p>` : ''}
        <p><strong>Subscription:</strong> ${subscriptionId}</p>
      `,
    });
  } catch (e) {
    console.error('Failed to send admin recurring cancellation email', e);
  }
}
