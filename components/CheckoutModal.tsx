'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { calculateLease, isOverSepaLimit, isLeaseAllowed, isPbiAllowed, isInvoiceAllowed, LEASE_MIN, LEASE_MAX, PBI_MIN, PBI_MAX, computeTotalPreorderDeposit, computePreorderQuote } from '@/lib/pricing';
import { isPreorderMode } from '@/lib/commerce-mode';
import { CartItem, CheckoutFormDraft } from '@/lib/types';
import { determineVatTreatment, computeVatAmounts } from '@/lib/vat';
import {
  aggregatedRecurringLinesFromCart,
  hasRecurringServices,
  recurringServicesMonthly,
} from '@/lib/cart-services';
import RecurringServicesSummary from '@/components/RecurringServicesSummary';
import VatPriceLine from '@/components/VatPriceLine';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onOrderComplete: () => void;
  // Optional pre-filled data (from persisted draft) so info survives Stripe cancel.
  initialData?: CheckoutFormDraft | null;
  // Called as the user types so parent can keep the draft in sync (for persistence).
  onDraftChange?: (partial: Partial<CheckoutFormDraft>) => void;
}

export default function CheckoutModal({ cart, onClose, onOrderComplete, initialData, onDraftChange }: Props) {
  const t = useTranslations('checkout');
  const tcart = useTranslations('cart');
  const tc = useTranslations();

  // Initialize from persisted draft if present (e.g. user filled form, went to Stripe, canceled).
  const [company, setCompany] = useState(initialData?.company || '');
  const [vat, setVat] = useState(initialData?.vatNumber || '');
  const [po, setPo] = useState(initialData?.poNumber || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [city, setCity] = useState(initialData?.city || '');
  const [postal, setPostal] = useState(initialData?.postal || '');
  const [country, setCountry] = useState(initialData?.country || 'FR');
  const [deliveryDifferent, setDeliveryDifferent] = useState(initialData?.deliveryDifferent || false);
  const [deliveryAddress, setDeliveryAddress] = useState(initialData?.deliveryAddress || '');
  const [deliveryCity, setDeliveryCity] = useState(initialData?.deliveryCity || '');
  const [deliveryPostal, setDeliveryPostal] = useState(initialData?.deliveryPostal || '');
  const [deliveryCountry, setDeliveryCountry] = useState(initialData?.deliveryCountry || initialData?.country || 'FR');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'sepa' | 'invoice'>(initialData?.paymentMethod || 'stripe');
  const [financing, setFinancing] = useState<'full' | 'lease'>(initialData?.financing || 'full');

  // When paymentMethod==='invoice' AND the cart contains recurring services, the user picks (inside the
  // invoice box) how the recurring services will be paid: 'stripe' (card) or 'sepa'. The main hardware/upfront
  // still uses the Net-30 invoice; this only affects creation of automatic service subs (via a mode:'setup' session).
  const [recurringPaymentMethod, setRecurringPaymentMethod] = useState<'stripe' | 'sepa'>(initialData?.recurringPaymentMethod || 'stripe');

  // VAT-inclusive election (professional customer choice). Only offered by UI when
  // determineVatTreatment says it is legally permitted (never for mandatory reverse charge).
  // Server is authoritative and will reject illegal choices.
  const [vatInclusive, setVatInclusive] = useState<boolean>(initialData?.vatInclusive || false);

  // Live VIES validation (server authoritative; preview only here).
  const [viesStatus, setViesStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable'>('idle');
  const [viesMessage, setViesMessage] = useState('');

  // Email collected here (part of checkout), kept in payload, transmitted to Stripe (pre-created Customer preferred; falls back to customer_email).
  const [email, setEmail] = useState(initialData?.email || '');

  // Wrapped setters that also push changes to parent so the draft is kept up to date in localStorage
  // even if the user partially fills the form and closes the modal.
  const updateDraft = (partial: Partial<CheckoutFormDraft>) => onDraftChange?.(partial);

  const setCompanyWithDraft = (v: string) => { setCompany(v); updateDraft({ company: v }); };
  const setVatWithDraft = (v: string) => { setVat(v); updateDraft({ vatNumber: v }); };
  const setPoWithDraft = (v: string) => { setPo(v); updateDraft({ poNumber: v }); };
  const setAddressWithDraft = (v: string) => { setAddress(v); updateDraft({ address: v }); };
  const setCityWithDraft = (v: string) => { setCity(v); updateDraft({ city: v }); };
  const setPostalWithDraft = (v: string) => { setPostal(v); updateDraft({ postal: v }); };
  const setCountryWithDraft = (v: string) => { setCountry(v); updateDraft({ country: v }); };
  const setDeliveryDifferentWithDraft = (v: boolean) => { setDeliveryDifferent(v); updateDraft({ deliveryDifferent: v }); };
  const setDeliveryAddressWithDraft = (v: string) => { setDeliveryAddress(v); updateDraft({ deliveryAddress: v }); };
  const setDeliveryCityWithDraft = (v: string) => { setDeliveryCity(v); updateDraft({ deliveryCity: v }); };
  const setDeliveryPostalWithDraft = (v: string) => { setDeliveryPostal(v); updateDraft({ deliveryPostal: v }); };
  const setDeliveryCountryWithDraft = (v: string) => { setDeliveryCountry(v); updateDraft({ deliveryCountry: v }); };
  const setPaymentMethodWithDraft = (v: 'stripe' | 'sepa' | 'invoice') => { setPaymentMethod(v); updateDraft({ paymentMethod: v }); };
  const setFinancingWithDraft = (v: 'full' | 'lease') => { setFinancing(v); updateDraft({ financing: v }); };
  const setRecurringPaymentMethodWithDraft = (v: 'stripe' | 'sepa') => { setRecurringPaymentMethod(v); updateDraft({ recurringPaymentMethod: v }); };
  const setVatInclusiveWithDraft = (v: boolean) => { setVatInclusive(v); updateDraft({ vatInclusive: v }); };
  const setEmailWithDraft = (v: string) => { setEmail(v); updateDraft({ email: v }); };


  const preorderMode = isPreorderMode();
  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const preorderDeposit = preorderMode ? computeTotalPreorderDeposit(cart) : 0;
  const preorderQuote = preorderMode ? computePreorderQuote(hardwareTotal, preorderDeposit) : null;

  const servicesMonthly = recurringServicesMonthly(cart);
  const cartHasRecurring = hasRecurringServices(cart);
  const recurringLines = aggregatedRecurringLinesFromCart(cart);

  // Always compute lease preview numbers (independent of current financing choice).
  // Uses centralized calculateLease so client/server stay in sync.
  const leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
  const leaseMonths = leaseDetails.months;

  const canLease = leaseDetails.isAllowed;
  const canPbi = isPbiAllowed(hardwareTotal);
  const canInvoicePolicy = isInvoiceAllowed(financing, servicesMonthly);
  const canUseInvoice = preorderMode ? true : (canPbi && canInvoicePolicy);

  // Current selection
  const isLease = financing === 'lease';

  // Debounced VIES check when a VAT number is entered (format must pass first).
  useEffect(() => {
    const trimmed = vat.trim();
    if (!trimmed) {
      setViesStatus('idle');
      setViesMessage('');
      return;
    }

    const timer = setTimeout(async () => {
      setViesStatus('checking');
      setViesMessage('');
      try {
        const res = await fetch('/api/vat/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vatNumber: trimmed, country }),
        });
        const data = await res.json().catch(() => ({}));
        if (data.valid) {
          setViesStatus('valid');
          setViesMessage(data.name ? t('viesValidWithName', { name: data.name }) : t('viesValid'));
        } else if (res.status === 503 || data.unavailable) {
          setViesStatus('unavailable');
          setViesMessage(data.reason || t('viesUnavailable'));
        } else {
          setViesStatus('invalid');
          setViesMessage(data.reason || t('viesInvalid'));
        }
      } catch {
        setViesStatus('unavailable');
        setViesMessage(t('viesUnavailable'));
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [vat, country, t]);

  // VAT treatment (pure, client+server identical). Drives whether we can legally show the
  // "I wish to be billed VAT-inclusive" checkbox and what the live gross preview should be.
  const viesValidatedPreview =
    viesStatus === 'valid' ? true : viesStatus === 'invalid' ? false : undefined;
  const vatTreatment = determineVatTreatment({
    customerCountry: country,
    vatNumber: vat,
    viesValidated: viesValidatedPreview,
  });
  const canOfferVatInclusive = vatTreatment.canOfferVatInclusive;
  /** Step 2 is skipped when pre-order mode offers no VAT choice and no financing. */
  const showTermsStep = canOfferVatInclusive || !preorderMode;
  const vatBlocksCheckout = !!vat.trim() && (viesStatus === 'invalid' || viesStatus === 'checking' || viesStatus === 'unavailable');

  const showVatBreakdown = !!vatInclusive && vatTreatment.vatRate > 0;
  const vatRateForDisplay = vatTreatment.vatRate;

  // Live recompute of billed amounts for preview.
  // Lease math + pricing always stays on the net/ex-VAT base (server does the same).
  // When user elects VAT-inclusive (and it is allowed), we gross the *displayed* numbers
  // and use the translated "vatBreakdown" key (source of truth in locales/*.json) for the standardized per-language text.
  const vatPreview = computeVatAmounts(hardwareTotal, vatRateForDisplay, vatInclusive);

  const hwNet = hardwareTotal;
  const hwGross = showVatBreakdown ? vatPreview.gross : hwNet;
  const hwVat = showVatBreakdown ? vatPreview.vatAmount : 0;

  // Recurring services (grossed when VAT chosen)
  const svcNet = servicesMonthly;
  const svcGross = showVatBreakdown ? computeVatAmounts(svcNet, vatRateForDisplay, true).gross : svcNet;
  const grossRecurring = showVatBreakdown
    ? (net: number) => computeVatAmounts(net, vatRateForDisplay, true).gross
    : undefined;

  // Lease figures: keep the net details for math/limits, use *Display for all UI text when VAT
  const leaseNetDetails = leaseDetails;
  const leaseUpfrontDisplay = showVatBreakdown
    ? computeVatAmounts(leaseNetDetails.upfrontAmount, vatRateForDisplay, true).gross
    : leaseNetDetails.upfrontAmount;
  const leaseMonthlyDisplay = showVatBreakdown
    ? computeVatAmounts(leaseNetDetails.monthlyTotal, vatRateForDisplay, true).gross
    : leaseNetDetails.monthlyTotal;
  const leaseMonthlyVatDisplay = showVatBreakdown
    ? computeVatAmounts(leaseNetDetails.monthlyTotal, vatRateForDisplay, true).vatAmount
    : 0;
  const leaseUpfrontVatDisplay = showVatBreakdown
    ? computeVatAmounts(leaseNetDetails.upfrontAmount, vatRateForDisplay, true).vatAmount
    : 0;

  const preorderDepositNet = preorderQuote?.totalDeposit ?? 0;
  const preorderDepositGross = showVatBreakdown
    ? computeVatAmounts(preorderDepositNet, vatRateForDisplay, true).gross
    : preorderDepositNet;
  const preorderDepositVat = showVatBreakdown
    ? computeVatAmounts(preorderDepositNet, vatRateForDisplay, true).vatAmount
    : 0;
  const preorderBalanceNet = preorderQuote?.balanceDue ?? 0;
  const preorderBalanceGross = showVatBreakdown
    ? computeVatAmounts(preorderBalanceNet, vatRateForDisplay, true).gross
    : preorderBalanceNet;
  const preorderBalanceVat = showVatBreakdown
    ? computeVatAmounts(preorderBalanceNet, vatRateForDisplay, true).vatAmount
    : 0;

  // Auto-uncheck (and persist) if the customer changes country or VAT such that the choice
  // is no longer legally offerable. Prevents sending an illegal choice on submit.
  useEffect(() => {
    if (!canOfferVatInclusive && vatInclusive) {
      setVatInclusiveWithDraft(false);
    }
  }, [canOfferVatInclusive, vatInclusive]);

  // Lease is only available inside hardware total range — fall back to pay-in-full when out of range.
  useEffect(() => {
    if (!canLease && financing === 'lease') {
      setFinancingWithDraft('full');
    }
  }, [canLease, financing, hardwareTotal, servicesMonthly]);

  const locale = useLocale();

  const countryOptions = [
    { value: 'FR', label: t('countries.FR') },
    { value: 'DE', label: t('countries.DE') },
    { value: 'NL', label: t('countries.NL') },
    { value: 'BE', label: t('countries.BE') },
    { value: 'ES', label: t('countries.ES') },
    { value: 'IT', label: t('countries.IT') },
    { value: 'other', label: t('countries.other') },
  ];

  const validateStep1 = () => {
    if (!company || !email || !address || !city) {
      alert(t('validation'));
      return false;
    }
    if (deliveryDifferent && (!deliveryAddress || !deliveryCity)) {
      alert(t('validationDelivery'));
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (vat.trim() && viesStatus === 'checking') {
      alert(t('viesStillChecking'));
      return false;
    }
    if (vat.trim() && viesStatus === 'invalid') {
      alert(viesMessage || t('viesInvalid'));
      return false;
    }
    if (vat.trim() && viesStatus === 'unavailable') {
      alert(viesMessage || t('viesUnavailable'));
      return false;
    }
    return true;
  };

  const handleNextStep = () => {
    if (isSubmitting) return;
    if (step === 1 && validateStep1()) setStep(showTermsStep ? 2 : 3);
    else if (step === 2 && validateStep2()) setStep(3);
  };

  const handlePreviousStep = () => {
    if (isSubmitting) return;
    if (step === 3 && !showTermsStep) setStep(1);
    else if (step > 1) setStep((step - 1) as 1 | 2 | 3);
  };

  const goToStep = (target: 1 | 2 | 3) => {
    if (isSubmitting) return;
    if (target === 1) {
      setStep(1);
      return;
    }
    if (!validateStep1()) return;
    if (target === 2) {
      if (showTermsStep) setStep(2);
      else if (validateStep2()) setStep(3);
      return;
    }
    if (validateStep2()) setStep(3);
  };

  const handleCompleteOrder = async () => {
    if (isSubmitting) return;
    if (!validateStep1() || !validateStep2()) return;

    if (vat.trim() && viesStatus !== 'valid') {
      if (viesStatus === 'checking') {
        alert(t('viesStillChecking'));
      } else if (viesStatus === 'unavailable') {
        alert(viesMessage || t('viesUnavailable'));
      } else {
        alert(viesMessage || t('viesInvalid'));
      }
      return;
    }

    if ((financing === 'lease' && !canLease) || (paymentMethod === 'invoice' && !canUseInvoice)) {
      alert(t('validation'));
      return;
    }

    setIsSubmitting(true);

    // Real flow for 'stripe' / 'sepa' / 'invoice' (invoice is now real Stripe send_invoice backend path;
    // the friendly localized overlay is still shown client-side for consistency after the backend
    // has created the real Invoice + Customer + sent it).

    // Real Stripe flow for 'stripe' / 'sepa' (and now invoice too)
    try {
      const payload: any = {
        items: cart,
        email,
        company,
        vatNumber: vat,
        poNumber: po,
        address,
        city,
        postal,
        country,
        deliveryDifferent,
        ...(deliveryDifferent
          ? {
              deliveryAddress,
              deliveryCity,
              deliveryPostal,
              deliveryCountry,
            }
          : {}),
        paymentMethod,
        financing,
        locale,
        // Always include (optional in type). Server will ignore or reject based on current determination.
        vatInclusive,
      };
      if (paymentMethod === 'invoice' && cartHasRecurring) {
        payload.recurringPaymentMethod = recurringPaymentMethod;
      }
      // Include order_placed_at if known from draft (server captures the authoritative value
      // at the successful response for the "recurring starts exactly 1 month after order time"
      // rule using billing_cycle_anchor). This helps keep the value stable across cancels/retries.
      if (initialData?.order_placed_at) {
        payload.order_placed_at = initialData.order_placed_at;
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || 'Failed to create checkout session');
      }

      const data = await res.json();
      if (data.url) {
        // Redirect to Stripe hosted Checkout (direct payment or subscription) or hosted invoice (lease)
        window.location.href = data.url;
        return;
      }

      if (data.success) {
        // Pay by Invoice (now real Stripe send_invoice path) or other success-only responses.
        // Show the friendly localized success overlay (same UX the previous mock provided)
        // while the backend has already created the real Customer + Invoice and finalized it.
        onOrderComplete();

        const orderNum = `NC-${Date.now().toString().slice(-8)}`;
        const successMessage = t('success.invoice', { company });
        const orderConfirmed = t('success.orderConfirmed');
        const orderNumLabel = t('success.orderNumLabel');
        const paymentLabel = t('success.paymentLabel');
        const totalLabel = t('success.totalLabel');
        const returnHome = t('success.returnHome');

        const successDiv = document.createElement('div');
        successDiv.className = `fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-6`;

        const inner = document.createElement('div');
        inner.className = 'bg-slate-900 border border-slate-700 max-w-md w-full rounded-3xl p-8 text-center';

        const iconWrap = document.createElement('div');
        iconWrap.className = 'mx-auto w-16 h-16 bg-emerald-900/30 rounded-full flex items-center justify-center mb-6';
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-check text-emerald-400 text-4xl';
        iconWrap.appendChild(icon);

        const h3 = document.createElement('h3');
        h3.className = 'text-2xl font-semibold tracking-tight mb-3';
        h3.textContent = orderConfirmed;

        const p = document.createElement('p');
        p.className = 'text-slate-400 mb-6';
        p.textContent = successMessage;

        const meta = document.createElement('div');
        meta.className = 'text-left bg-slate-950 p-4 rounded-2xl text-sm mb-6';

        const row1 = document.createElement('div'); row1.className = 'flex justify-between py-1';
        const s1 = document.createElement('span'); s1.className = 'text-slate-400'; s1.textContent = orderNumLabel;
        const v1 = document.createElement('span'); v1.className = 'font-mono'; v1.textContent = orderNum;
        row1.append(s1, v1);

        const row2 = document.createElement('div'); row2.className = 'flex justify-between py-1';
        const s2 = document.createElement('span'); s2.className = 'text-slate-400'; s2.textContent = 'Email';
        const v2 = document.createElement('span'); v2.className = 'font-mono'; v2.textContent = email;
        row2.append(s2, v2);

        const row3 = document.createElement('div'); row3.className = 'flex justify-between py-1';
        const s3 = document.createElement('span'); s3.className = 'text-slate-400'; s3.textContent = paymentLabel;
        const v3 = document.createElement('span'); v3.className = 'capitalize'; v3.textContent = paymentMethod;
        row3.append(s3, v3);

        const row4 = document.createElement('div'); row4.className = 'flex justify-between py-1';
        const s4 = document.createElement('span'); s4.className = 'text-slate-400'; s4.textContent = totalLabel;
        // For the success overlay (invoice path), show the gross headline amount consistent with the modal total.
        // Lease uses upfront for the "today" invoice in some flows, but this overlay is primarily for full invoice.
        const overlayHeadline = isLease ? leaseUpfrontDisplay : (showVatBreakdown ? hwGross : hardwareTotal);
        const v4 = document.createElement('span'); v4.className = 'font-semibold'; v4.textContent = tc('common.price', { amount: overlayHeadline });
        row4.append(s4, v4);

        meta.append(row1, row2, row3, row4);

        const btn = document.createElement('button');
        btn.className = 'w-full py-3.5 bg-white text-slate-950 font-bold rounded-3xl';
        btn.textContent = returnHome;
        btn.onclick = () => { successDiv.remove(); window.location.reload(); };

        inner.append(iconWrap, h3, p, meta, btn);
        successDiv.appendChild(inner);
        document.body.appendChild(successDiv);
        return;
      }

      throw new Error('No checkout URL returned');
    } catch (e: any) {
      console.error('Checkout error', e);
      const msg = e?.message || 'Please try again or contact support.';
      alert(`Unable to start payment: ${msg}`);
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4" onClick={handleClose}>
      <div className="relative bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl flex flex-col max-h-[92vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        {isSubmitting && (
          <div className="absolute inset-0 z-20 bg-slate-950/85 flex flex-col items-center justify-center px-6">
            <div className="w-9 h-9 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
            <p className="mt-4 text-sm text-slate-300 text-center">{t('processingPayment')}</p>
          </div>
        )}
        
        <div className="px-7 py-5 border-b border-slate-800 flex justify-between items-start flex-shrink-0">
          <div>
            <div className="font-semibold text-xl">{t('completeOrder')}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-xs">
              <button
                type="button"
                onClick={() => goToStep(1)}
                disabled={isSubmitting}
                className={`transition-colors hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed ${step === 1 ? 'text-cyan-400 font-medium' : 'text-slate-500'}`}
              >
                1. {t('stepInfo')}
              </button>
              <span className="text-slate-600">→</span>
              <button
                type="button"
                onClick={() => goToStep(2)}
                disabled={isSubmitting}
                className={`transition-colors hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed ${step === 2 ? 'text-cyan-400 font-medium' : 'text-slate-500'}`}
              >
                2. {t('stepTerms')}
              </button>
              <span className="text-slate-600">→</span>
              <button
                type="button"
                onClick={() => goToStep(3)}
                disabled={isSubmitting}
                className={`transition-colors hover:text-cyan-300 disabled:opacity-50 disabled:cursor-not-allowed ${step === 3 ? 'text-cyan-400 font-medium' : 'text-slate-500'}`}
              >
                3. {t('stepPayment')}
              </button>
            </div>
          </div>
          <button onClick={handleClose} disabled={isSubmitting} className="text-2xl text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className={`p-7 space-y-6 ${isSubmitting ? 'pointer-events-none opacity-50' : ''}`}>
          {step === 1 && (
          <>
          {/* Company Info */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('companyInfo')}</div>
            <div className="space-y-3">
              <input value={company} onChange={e => setCompanyWithDraft(e.target.value)} type="text" placeholder={t('companyPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" />
              {/* Email collected as part of our checkout (kept + transmitted to Stripe for customer ownership). */}
              <input
                value={email}
                onChange={e => setEmailWithDraft(e.target.value)}
                type="email"
                placeholder={t('emailPlaceholder')}
                className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input value={vat} onChange={e => setVatWithDraft(e.target.value)} type="text" placeholder={t('vatPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                  {vat.trim() && (
                    <div className={`text-[10px] mt-1 ${
                      viesStatus === 'valid' ? 'text-emerald-400'
                        : viesStatus === 'checking' ? 'text-slate-400'
                          : viesStatus === 'idle' ? 'text-slate-500'
                            : 'text-amber-400'
                    }`}>
                      {viesStatus === 'checking' && t('viesChecking')}
                      {viesStatus === 'valid' && (viesMessage || t('viesValid'))}
                      {viesStatus === 'invalid' && (viesMessage || t('viesInvalid'))}
                      {viesStatus === 'unavailable' && (viesMessage || t('viesUnavailable'))}
                    </div>
                  )}
                </div>
                <input value={po} onChange={e => setPoWithDraft(e.target.value)} type="text" placeholder={t('poPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
              </div>
            </div>
          </div>

          {/* Billing Address - Added as requested */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('billingAddress')}</div>
            <div className="space-y-3">
              <input 
                value={address} 
                onChange={e => setAddressWithDraft(e.target.value)}
                type="text" placeholder={t('streetPlaceholder')} 
                className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" 
              />
              <div className="grid grid-cols-2 gap-3">
                <input value={city} onChange={e => setCityWithDraft(e.target.value)} type="text" placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                <input value={postal} onChange={e => setPostalWithDraft(e.target.value)} type="text" placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
              </div>
              <select value={country} onChange={e => setCountryWithDraft(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                {countryOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-start gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
            <input
              type="checkbox"
              checked={deliveryDifferent}
              onChange={(e) => setDeliveryDifferentWithDraft(e.target.checked)}
              className="accent-cyan-400 mt-1"
            />
            <div className="font-medium text-sm">{t('deliveryDifferentLabel')}</div>
          </label>

          {deliveryDifferent && (
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('deliveryAddress')}</div>
              <div className="space-y-3">
                <input
                  value={deliveryAddress}
                  onChange={e => setDeliveryAddressWithDraft(e.target.value)}
                  type="text"
                  placeholder={t('streetPlaceholder')}
                  className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input value={deliveryCity} onChange={e => setDeliveryCityWithDraft(e.target.value)} type="text" placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                  <input value={deliveryPostal} onChange={e => setDeliveryPostalWithDraft(e.target.value)} type="text" placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                </div>
                <select value={deliveryCountry} onChange={e => setDeliveryCountryWithDraft(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                  {countryOptions.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          </>
          )}

          {step === 2 && (
          <>
          {/* VAT-inclusive choice for professional customers (spec: only when legally permitted,
              never when reverse charge is mandatory). Server validates authoritatively. */}
          {canOfferVatInclusive && (
            <div>
              <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('vatTreatment')}</div>
              <label className="flex items-start gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input
                  type="checkbox"
                  checked={vatInclusive}
                  onChange={(e) => setVatInclusiveWithDraft(e.target.checked)}
                  className="accent-cyan-400 mt-1"
                />
                <div className="flex-1">
                  <div className="font-medium">{t('vatInclusiveLabel')}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{t('vatInclusiveExplanation')}</div>
                  {vatInclusive && vatTreatment.vatRate > 0 && (
                    <div className="text-[10px] text-amber-400 mt-1">
                      {t('vatInclusiveWarning', { rate: Math.round(vatTreatment.vatRate * 100) })}
                    </div>
                  )}
                </div>
              </label>
            </div>
          )}

          {/* Financing (hidden in pre-order mode) */}
          {!preorderMode && (
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('financingLabel')}</div>
            <div className="space-y-3">
              <label 
                className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950"
              >
                <input 
                  type="radio" 
                  name="financing" 
                  value="full" 
                  checked={financing === 'full'} 
                  onChange={() => {
                    setFinancingWithDraft('full');
                    if (paymentMethod === 'sepa' && isOverSepaLimit(hwGross)) setPaymentMethodWithDraft('stripe');
                    if (paymentMethod === 'invoice' && !canPbi) setPaymentMethodWithDraft('stripe');
                  }} 
                  className="accent-cyan-400" 
                />
                <div className="flex-1">
                  <div className="font-medium">{t('payFull')}</div>
                  <div className="text-xs text-slate-400">
                    {t('payFullDesc')} — {tc('common.price', { amount: hwGross })}
                    {showVatBreakdown ? ` (${t('vatBreakdown', { net: hwNet, vat: hwVat })})` : ''}
                  </div>
                </div>
              </label>

              <label 
                className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950"
              >
                <input 
                  type="radio" 
                  name="financing" 
                  value="lease" 
                  checked={financing === 'lease'} 
                  disabled={!canLease}
                  onChange={() => {
                    if (canLease) {
                      setFinancingWithDraft('lease');
                      if (paymentMethod === 'sepa' && isOverSepaLimit(leaseMonthlyDisplay)) setPaymentMethodWithDraft('stripe');
                      if (paymentMethod === 'invoice') setPaymentMethodWithDraft('stripe');
                    } else {
                      setFinancingWithDraft('full');
                      if (paymentMethod === 'invoice' && !canPbi) setPaymentMethodWithDraft('stripe');
                    }
                  }} 
                  className="accent-cyan-400" 
                />
                <div className="flex-1">
                  <div className="font-medium">{t('lease')}</div>
                  <div className="text-xs text-slate-400">
                    {t('leaseDesc', { months: leaseMonths })}
                  </div>
                  {canLease && (
                    <>
                      <div className="text-xs text-emerald-400 mt-0.5">
                        {showVatBreakdown ? (
                          t('monthlyPaymentWithVat', {
                            amount: leaseMonthlyDisplay,
                            months: leaseMonths,
                            breakdown: t('vatBreakdown', {
                              net: leaseNetDetails.monthlyTotal,
                              vat: leaseMonthlyVatDisplay
                            })
                          })
                        ) : (
                          t('monthlyPayment', { amount: leaseMonthlyDisplay, months: leaseMonths })
                        )}
                      </div>
                      <div className="text-[10px] mt-1 pt-1 border-t border-slate-700/70 text-amber-400">
                        {showVatBreakdown ? (
                          t('oneTimeUpfrontDueTodayWithVat', {
                            amount: leaseUpfrontDisplay,
                            breakdown: t('vatBreakdown', {
                              net: leaseNetDetails.upfrontAmount,
                              vat: leaseUpfrontVatDisplay
                            })
                          })
                        ) : (
                          t('upfrontDueToday', { amount: leaseUpfrontDisplay })
                        )}
                      </div>
                    </>
                  )}
                  <div className="text-[10px] text-slate-500 mt-0.5">{t('firstMonthNote')}</div>
                  {!canLease && (
                    <div className="text-[10px] text-amber-400 mt-0.5">{t('leaseRangeNote', { min: LEASE_MIN, max: LEASE_MAX })}</div>
                  )}
                </div>
              </label>
            </div>
          </div>
          )}
          </>
          )}

          {step === 3 && (
          <>
          {preorderMode && (
            <div className="p-4 border border-amber-500/30 bg-amber-500/5 rounded-2xl text-sm text-slate-300 space-y-1">
              <p className="font-medium text-amber-200/90">{t('preorderNoticeTitle')}</p>
              <p>{t('preorderNoticeBody', {
                deposit: showVatBreakdown ? preorderDepositGross : preorderDeposit,
                balance: showVatBreakdown ? preorderBalanceGross : preorderBalanceNet,
              })}</p>
              {showVatBreakdown && (
                <p className="text-xs text-slate-400">
                  {t('preorderVatNote', {
                    depositNet: preorderDeposit,
                    depositVat: preorderDepositVat,
                    rate: Math.round(vatRateForDisplay * 100),
                  })}
                </p>
              )}
            </div>
          )}

          {/* Payment Method */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('paymentMethod')}</div>
            <div className="space-y-3">
              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethodWithDraft('stripe')} className="accent-cyan-400" />
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-x-2">{t('card')} <span className="text-[10px] px-2 py-px bg-slate-800 rounded">{t('cardTag')}</span></div>
                  <div className="text-xs text-slate-400">{t('cardDesc')}</div>
                </div>
              </label>

              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input 
                  type="radio" 
                  name="payment" 
                  value="sepa" 
                  checked={paymentMethod === 'sepa'} 
                  onChange={() => setPaymentMethodWithDraft('sepa')} 
                  className="accent-cyan-400"
                  disabled={ preorderMode
                    ? isOverSepaLimit(preorderDeposit)
                    : (financing === 'lease' && isOverSepaLimit(leaseMonthlyDisplay)) || (financing === 'full' && isOverSepaLimit(hwGross)) }
                />
                <div className="flex-1">
                  <div className="font-medium">{t('sepa')}</div>
                  <div className="text-xs text-slate-400">
                    {t('sepaDesc')}
                    { ( preorderMode
                      ? isOverSepaLimit(preorderDeposit)
                      : (financing === 'lease' && isOverSepaLimit(leaseMonthlyDisplay)) || (financing === 'full' && isOverSepaLimit(hwGross)) ) && (
                      <span className="text-amber-400 ml-1">(max {tc('common.price', { amount: 10000 })} — choose card or reduce order)</span>
                    )}
                  </div>
                </div>
              </label>

              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input 
                  type="radio" 
                  name="payment" 
                  value="invoice" 
                  checked={paymentMethod === 'invoice'} 
                  disabled={!canUseInvoice}
                  onChange={() => {
                    if (canUseInvoice) setPaymentMethodWithDraft('invoice');
                    else setPaymentMethodWithDraft('stripe');
                  }} 
                  className="accent-cyan-400" 
                />
                <div className="flex-1">
                  <div className="font-medium">{t('invoice')}</div>
                  <div className="text-xs text-slate-400">{t('invoiceDesc')}</div>
                  {!preorderMode && !canPbi && (
                    <div className="text-[10px] text-amber-400 mt-0.5">{t('invoiceRangeNote', { min: PBI_MIN, max: PBI_MAX })}</div>
                  )}
                  {canPbi && !canInvoicePolicy && (
                    <div className="text-[10px] text-amber-400 mt-0.5">{t('invoicePolicyNote')}</div>
                  )}

                  {/* When the user chooses Pay by Invoice for the hardware/upfront but the order has recurring services,
                      they must pick (inside this box) how the *recurring* part is paid: card or SEPA.
                      The backend will create the Net-30 invoice for hardware and a mode:'setup' Checkout for the
                      recurring PM so that service subs are automatic (charge_automatically) instead of send_invoice. */}
                  {cartHasRecurring && paymentMethod === 'invoice' && (
                    <div className="mt-3 rounded-xl bg-slate-950 p-3 border border-slate-700/60">
                      <div className="text-[10px] uppercase tracking-widest text-slate-400 mb-2 font-medium">
                        {t('recurringPaymentForServices')}
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-start gap-x-2.5 cursor-pointer">
                          <input
                            type="radio"
                            name="recurringPayment"
                            value="stripe"
                            checked={recurringPaymentMethod === 'stripe'}
                            onChange={() => setRecurringPaymentMethodWithDraft('stripe')}
                            className="accent-cyan-400 mt-0.5"
                          />
                          <div className="text-sm leading-tight">
                            <span className="font-medium">{t('recurringCard')}</span>{' '}
                            <span className="text-[10px] px-1.5 py-px bg-slate-800 rounded align-baseline">{t('recurringCardTag')}</span>
                          </div>
                        </label>
                        <label className="flex items-start gap-x-2.5 cursor-pointer">
                          <input
                            type="radio"
                            name="recurringPayment"
                            value="sepa"
                            checked={recurringPaymentMethod === 'sepa'}
                            onChange={() => setRecurringPaymentMethodWithDraft('sepa')}
                            disabled={isOverSepaLimit(svcGross)}
                            className="accent-cyan-400 mt-0.5"
                          />
                          <div className="text-sm leading-tight">
                            <div className="font-medium">{t('recurringSepa')}</div>
                            <div className="text-xs text-slate-400 mt-0.5">{t('recurringSepaDesc')}</div>
                            {isOverSepaLimit(svcGross) && (
                              <div className="text-amber-400 text-[10px] mt-0.5">(max {tc('common.price', { amount: 10000 })} — choose card)</div>
                            )}
                          </div>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
          </>
          )}
          </div>

          <div className={`bg-slate-950 px-7 py-5 border-t border-slate-800 flex justify-between items-center ${isSubmitting ? 'pointer-events-none' : ''}`}>
          <div className="min-w-0 flex-1 pr-4">
            {step === 1 ? (
              <>
                <VatPriceLine
                  label={tcart('hardwareTotal')}
                  amount={hwNet}
                  net={hwNet}
                  vat={0}
                  showBreakdown={false}
                  className="mb-1"
                />
                {cartHasRecurring && (
                  <RecurringServicesSummary
                    lines={recurringLines}
                    showPmNote
                    className="mt-1"
                    nameClassName="text-slate-400"
                  />
                )}
              </>
            ) : preorderMode ? (
              <>
                <VatPriceLine
                  label={t('preorderDepositToday')}
                  amount={preorderDepositGross}
                  net={preorderDepositNet}
                  vat={preorderDepositVat}
                  showBreakdown={showVatBreakdown}
                  variant="summary"
                />
                <div className="mt-2.5 pt-2 border-t border-slate-700/70">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
                    {t('preorderDueLaterTitle')}
                  </div>
                  <VatPriceLine
                    label={t('preorderBalanceAtShip')}
                    amount={preorderBalanceGross}
                    net={preorderBalanceNet}
                    vat={preorderBalanceVat}
                    showBreakdown={showVatBreakdown}
                    variant="row"
                    className="text-xs"
                  />
                  {cartHasRecurring && (
                    <RecurringServicesSummary
                      lines={recurringLines}
                      variant="both"
                      showPmNote
                      grossAmount={grossRecurring}
                      className="mt-2"
                      nameClassName="text-slate-400"
                    />
                  )}
                </div>
              </>
            ) : (
              <>
                <VatPriceLine
                  label={
                    isLease
                      ? t('monthlyTotalLabel', { months: leaseMonths })
                      : t('totalToPay')
                  }
                  amount={isLease ? leaseMonthlyDisplay : hwGross}
                  net={isLease ? leaseNetDetails.monthlyTotal : hwNet}
                  vat={isLease ? leaseMonthlyVatDisplay : hwVat}
                  showBreakdown={showVatBreakdown}
                  variant="summary"
                />

                {cartHasRecurring && (
                  <RecurringServicesSummary
                    lines={recurringLines}
                    variant="schedule"
                    showPmNote
                    grossAmount={grossRecurring}
                    className="text-[10px] text-emerald-400 mt-0.5"
                    nameClassName="text-emerald-400/90"
                  />
                )}

                {isLease && <div className="text-[10px] text-slate-500">{t('firstMonthNote')}</div>}

                {isLease && (
                  <div className="mt-1.5 pt-1.5 border-t border-slate-700/70 text-[10px] text-amber-400">
                    {showVatBreakdown ? (
                      t('oneTimeUpfrontDueTodayWithVat', {
                        amount: leaseUpfrontDisplay,
                        breakdown: t('vatBreakdown', {
                          net: leaseNetDetails.upfrontAmount,
                          vat: leaseUpfrontVatDisplay
                        })
                      })
                    ) : (
                      t('upfrontDueToday', { amount: leaseUpfrontDisplay })
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          {step < 3 ? (
            <div className={`shrink-0 flex flex-col items-stretch gap-2 ${step === 2 ? 'w-[148px]' : ''}`}>
              {step === 2 && (
                <button
                  onClick={handlePreviousStep}
                  disabled={isSubmitting}
                  className="px-4 py-2 border border-slate-600 text-slate-200 font-medium rounded-3xl text-xs hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {t('previousBtn')}
                </button>
              )}
              <button
                onClick={handleNextStep}
                disabled={isSubmitting}
                className="px-9 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {t('nextBtn')}
              </button>
            </div>
          ) : (
            <div className="shrink-0 flex flex-col items-stretch gap-2 w-[148px]">
              <button
                onClick={handlePreviousStep}
                disabled={isSubmitting}
                className="px-4 py-2 border border-slate-600 text-slate-200 font-medium rounded-3xl text-xs hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {t('previousBtn')}
              </button>
              <button
                onClick={handleCompleteOrder}
                disabled={isSubmitting || vatBlocksCheckout}
                className="px-4 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {preorderMode ? t('preorderCompleteBtn') : t('completeBtn')}
              </button>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
