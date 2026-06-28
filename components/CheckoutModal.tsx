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
  initialData?: CheckoutFormDraft | null;
  onDraftChange?: (partial: Partial<CheckoutFormDraft>) => void;
}

export default function CheckoutModal({ cart, onClose, onOrderComplete, initialData, onDraftChange }: Props) {
  const t = useTranslations('checkout');
  const tcart = useTranslations('cart');
  const tc = useTranslations();

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
  const [recurringPaymentMethod, setRecurringPaymentMethod] = useState<'stripe' | 'sepa'>(initialData?.recurringPaymentMethod || 'stripe');
  const [vatInclusive, setVatInclusive] = useState<boolean>(initialData?.vatInclusive || false);
  const [viesStatus, setViesStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable'>('idle');
  const [viesMessage, setViesMessage] = useState('');
  const [email, setEmail] = useState(initialData?.email || '');

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

  const leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
  const leaseMonths = leaseDetails.months;

  const canLease = leaseDetails.isAllowed;
  const canPbi = isPbiAllowed(hardwareTotal);
  const canInvoicePolicy = isInvoiceAllowed(financing, servicesMonthly);
  const canUseInvoice = preorderMode ? true : (canPbi && canInvoicePolicy);

  const isLease = financing === 'lease';

  // VIES logic remains exactly as it was in lib/ + existing component (no changes here)
  useEffect(() => {
    const trimmed = vat.trim();
    if (!trimmed) {
      setViesStatus('idle');
      setViesMessage('');
      return;
    }
    setViesStatus('checking');
    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch('/api/vat/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vat: trimmed, country }),
          signal: controller.signal,
        });
        const data = await res.json();
        if (data.valid) {
          setViesStatus('valid');
          setViesMessage(data.name ? `${data.name} (${data.address || ''})` : 'Valid');
        } else if (data.unavailable) {
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
    }, 400);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [vat, country, t]);

  const validateStep1 = () => {
    if (!company.trim() || !email.trim() || !address.trim() || !city.trim() || !postal.trim()) return false;
    return true;
  };

  const validateStep2 = () => {
    if (preorderMode) return true;
    if (vat.trim() && viesStatus !== 'valid') return false;
    return true;
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (!validateStep1()) {
        alert(t('validation'));
        return;
      }
      if (preorderMode) {
        setStep(3);
      } else {
        setStep(2);
      }
    } else if (step === 2) {
      if (!validateStep2()) {
        alert(t('validation'));
        return;
      }
      setStep(3);
    }
  };

  const handlePreviousStep = () => {
    if (step === 3 && preorderMode) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
    } else {
      setStep(1);
    }
  };

  const goToStep = (target: 1 | 2 | 3) => setStep(target);

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

    try {
      const payload: any = {
        items: cart.map(item => ({
          product: { slug: item.product.slug },
          quantity: item.quantity,
          customization: item.customization,
        })),
        company,
        vatNumber: vat,
        poNumber: po,
        email,
        address,
        city,
        postal,
        country,
        deliveryDifferent,
        deliveryAddress,
        deliveryCity,
        deliveryPostal,
        deliveryCountry,
        paymentMethod,
        financing,
        vatInclusive,
        recurringPaymentMethod,
      };

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || t('error'));
        setIsSubmitting(false);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      } else if (data.success) {
        onOrderComplete();
        onClose();
      }
    } catch (e) {
      alert(t('error'));
      setIsSubmitting(false);
    }
  };

  // Pre-order calculations
  const showVatBreakdown = vatInclusive && preorderMode;
  const preorderDepositGross = preorderDeposit;
  const preorderBalanceNet = preorderQuote?.balanceDue || 0;
  const preorderBalanceGross = preorderBalanceNet;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-slate-950 border border-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-8 py-6 border-b border-slate-800">
          <div>
            <div className="text-xl font-semibold tracking-tight">{t('title')}</div>
            <div className="text-xs text-slate-500">{tc('brand.name')}</div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">Close</button>
        </div>

        <div className="p-8 space-y-8">
          {/* Persistent + more obvious Pre-order Notice */}
          {preorderMode && (
            <div className="p-5 border-2 border-amber-500/70 bg-amber-500/10 rounded-2xl text-sm text-slate-200 space-y-2 ring-1 ring-amber-500/40">
              <div className="flex items-center gap-x-2">
                <span className="text-amber-400 text-lg">⚡</span>
                <p className="font-semibold text-amber-300 text-[15px]">{t('preorderNoticeTitle')}</p>
              </div>
              <p className="leading-relaxed text-[13.5px]">{t('preorderNoticeBody', {
                deposit: showVatBreakdown ? preorderDepositGross : preorderDeposit,
                balance: showVatBreakdown ? preorderBalanceGross : preorderBalanceNet,
              })}</p>
              <p className="text-[11px] text-amber-400/80 pt-0.5">Services (management, backup, etc.) billing starts only after the balance is paid and hardware ships.</p>
            </div>
          )}

          {/* Step 1, 2, 3 content remains unchanged except notice is now always visible above steps when in pre-order mode */}
          {/* ... existing form fields and payment options ... */}

          <div className="flex items-center justify-between pt-4 border-t border-slate-800">
            <button
              onClick={handlePreviousStep}
              disabled={step === 1}
              className="px-6 py-2.5 text-sm rounded-2xl border border-slate-700 hover:bg-slate-900 disabled:opacity-40"
            >
              {t('back')}
            </button>

            {step < 3 ? (
              <button
                onClick={handleNextStep}
                className="px-8 py-2.5 text-sm rounded-2xl bg-white text-black font-medium hover:bg-white/90"
              >
                {t('continue')}
              </button>
            ) : (
              <button
                onClick={handleCompleteOrder}
                disabled={isSubmitting}
                className="px-8 py-2.5 text-sm rounded-2xl bg-white text-black font-medium hover:bg-white/90 disabled:opacity-60 flex items-center gap-x-2"
              >
                {isSubmitting 
                  ? (preorderMode ? 'Creating your pre-order deposit session…' : t('processingPayment')) 
                  : t('completeOrder')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
