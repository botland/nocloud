'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { calculateLease, isOverSepaLimit, isLeaseAllowed, isPbiAllowed, isInvoiceAllowed, LEASE_MIN, LEASE_MAX, PBI_MIN, PBI_MAX } from '@/lib/pricing';
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
  const [step, setStep] = useState<1 | 2>(1);
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

  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const servicesMonthly = recurringServicesMonthly(cart);
  const cartHasRecurring = hasRecurringServices(cart);
  const recurringLines = aggregatedRecurringLinesFromCart(cart);

  const leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
  const leaseMonths = leaseDetails.months;

  const canLease = leaseDetails.isAllowed;
  const canPbi = isPbiAllowed(hardwareTotal);
  const canInvoicePolicy = isInvoiceAllowed(financing, servicesMonthly);
  const canUseInvoice = canPbi && canInvoicePolicy;

  const isLease = financing === 'lease';

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

  const viesValidatedPreview = viesStatus === 'valid' ? true : viesStatus === 'invalid' ? false : undefined;
  const vatTreatment = determineVatTreatment({ customerCountry: country, vatNumber: vat, viesValidated: viesValidatedPreview });
  const canOfferVatInclusive = vatTreatment.canOfferVatInclusive;
  const vatBlocksCheckout = !!vat.trim() && (viesStatus === 'invalid' || viesStatus === 'checking' || viesStatus === 'unavailable');

  const showVatBreakdown = !!vatInclusive && vatTreatment.vatRate > 0;
  const vatRateForDisplay = vatTreatment.vatRate;

  const vatPreview = computeVatAmounts(hardwareTotal, vatRateForDisplay, vatInclusive);

  const hwNet = hardwareTotal;
  const hwGross = showVatBreakdown ? vatPreview.gross : hwNet;
  const hwVat = showVatBreakdown ? vatPreview.vatAmount : 0;

  const svcNet = servicesMonthly;
  const svcGross = showVatBreakdown ? computeVatAmounts(svcNet, vatRateForDisplay, true).gross : svcNet;
  const grossRecurring = showVatBreakdown ? (net: number) => computeVatAmounts(net, vatRateForDisplay, true).gross : undefined;

  const leaseNetDetails = leaseDetails;
  const leaseUpfrontDisplay = showVatBreakdown ? computeVatAmounts(leaseNetDetails.upfrontAmount, vatRateForDisplay, true).gross : leaseNetDetails.upfrontAmount;
  const leaseMonthlyDisplay = showVatBreakdown ? computeVatAmounts(leaseNetDetails.monthlyTotal, vatRateForDisplay, true).gross : leaseNetDetails.monthlyTotal;
  const leaseMonthlyVatDisplay = showVatBreakdown ? computeVatAmounts(leaseNetDetails.monthlyTotal, vatRateForDisplay, true).vatAmount : 0;
  const leaseUpfrontVatDisplay = showVatBreakdown ? computeVatAmounts(leaseNetDetails.upfrontAmount, vatRateForDisplay, true).vatAmount : 0;

  useEffect(() => {
    if (!canOfferVatInclusive && vatInclusive) setVatInclusiveWithDraft(false);
  }, [canOfferVatInclusive, vatInclusive]);

  useEffect(() => {
    if (!canLease && financing === 'lease') setFinancingWithDraft('full');
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
    if (!company || !email || !address || !city) { alert(t('validation')); return false; }
    if (deliveryDifferent && (!deliveryAddress || !deliveryCity)) { alert(t('validationDelivery')); return false; }
    return true;
  };

  const handleNextStep = () => { if (isSubmitting) return; if (validateStep1()) setStep(2); };
  const handlePreviousStep = () => { if (isSubmitting) return; setStep(1); };
  const goToStep = (target: 1 | 2) => { if (isSubmitting) return; if (target === 1) { setStep(1); return; } if (validateStep1()) setStep(2); };

  const handleCompleteOrder = async () => {
    if (isSubmitting) return;
    if (!validateStep1()) return;
    if (vat.trim() && viesStatus !== 'valid') {
      if (viesStatus === 'checking') { alert(t('viesStillChecking')); return; }
      alert(viesMessage || (viesStatus === 'unavailable' ? t('viesUnavailable') : t('viesInvalid')));
      return;
    }
    if ((financing === 'lease' && !canLease) || (paymentMethod === 'invoice' && !canUseInvoice)) { alert(t('validation')); return; }

    setIsSubmitting(true);

    try {
      const payload: any = {
        items: cart, email, company, vatNumber: vat, poNumber: po,
        address, city, postal, country, deliveryDifferent,
        ...(deliveryDifferent ? { deliveryAddress, deliveryCity, deliveryPostal, deliveryCountry } : {}),
        paymentMethod, financing, locale, vatInclusive,
      };
      if (paymentMethod === 'invoice' && cartHasRecurring) payload.recurringPaymentMethod = recurringPaymentMethod;
      if (initialData?.order_placed_at) payload.order_placed_at = initialData.order_placed_at;

      const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create checkout session');

      const data = await res.json();
      if (data.url) { window.location.href = data.url; return; }
      if (data.success) {
        onOrderComplete();
        // success overlay code stays the same...
        return;
      }
      throw new Error('No checkout URL returned');
    } catch (e: any) {
      alert(`Unable to start payment: ${e?.message || 'Please try again'}`);
      setIsSubmitting(false);
    }
  };

  const handleClose = () => { if (isSubmitting) return; onClose(); };

  return (
    <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4" onClick={handleClose}>
      <div className="relative bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        {isSubmitting && (
          <div className="absolute inset-0 z-20 bg-slate-950/85 flex flex-col items-center justify-center px-6 rounded-3xl">
            <div className="w-9 h-9 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
            <p className="mt-4 text-sm text-slate-300">{t('processingPayment')}</p>
          </div>
        )}

        {/* Header - fixed */}
        <div className="px-7 py-5 border-b border-slate-800 flex justify-between items-start flex-shrink-0">
          <div>
            <div className="font-semibold text-xl">{t('completeOrder')}</div>
            <div className="flex items-center gap-2 mt-2 text-xs">
              <button type="button" onClick={() => goToStep(1)} disabled={isSubmitting} className={`transition-colors hover:text-cyan-300 disabled:opacity-50 ${step === 1 ? 'text-cyan-400 font-medium' : 'text-slate-500'}`}>1. {t('stepInfo')}</button>
              <span className="text-slate-600">→</span>
              <button type="button" onClick={() => goToStep(2)} disabled={isSubmitting} className={`transition-colors hover:text-cyan-300 disabled:opacity-50 ${step === 2 ? 'text-cyan-400 font-medium' : 'text-slate-500'}`}>2. {t('stepPayment')}</button>
            </div>
          </div>
          <button onClick={handleClose} disabled={isSubmitting} className="text-2xl text-slate-400 disabled:opacity-40">×</button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-7 space-y-6">
          {step === 1 && (
            <>
              {/* Company Info, Billing, Delivery, VAT-inclusive - same as before */}
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('companyInfo')}</div>
                <div className="space-y-3">
                  <input value={company} onChange={e => setCompanyWithDraft(e.target.value)} type="text" placeholder={t('companyPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" />
                  <input value={email} onChange={e => setEmailWithDraft(e.target.value)} type="email" placeholder={t('emailPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" />
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <input value={vat} onChange={e => setVatWithDraft(e.target.value)} type="text" placeholder={t('vatPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                      {vat.trim() && <div className={`text-[10px] mt-1 ${viesStatus === 'valid' ? 'text-emerald-400' : viesStatus === 'checking' ? 'text-slate-400' : 'text-amber-400'}`}>{viesStatus === 'checking' ? t('viesChecking') : viesStatus === 'valid' ? (viesMessage || t('viesValid')) : viesStatus === 'invalid' ? (viesMessage || t('viesInvalid')) : t('viesUnavailable')}</div>}
                    </div>
                    <input value={po} onChange={e => setPoWithDraft(e.target.value)} type="text" placeholder={t('poPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('billingAddress')}</div>
                <div className="space-y-3">
                  <input value={address} onChange={e => setAddressWithDraft(e.target.value)} type="text" placeholder={t('streetPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                  <div className="grid grid-cols-2 gap-3">
                    <input value={city} onChange={e => setCityWithDraft(e.target.value)} type="text" placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                    <input value={postal} onChange={e => setPostalWithDraft(e.target.value)} type="text" placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                  </div>
                  <select value={country} onChange={e => setCountryWithDraft(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                    {countryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </div>
              </div>

              <label className="flex items-start gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input type="checkbox" checked={deliveryDifferent} onChange={e => setDeliveryDifferentWithDraft(e.target.checked)} className="accent-cyan-400 mt-1" />
                <div className="font-medium text-sm">{t('deliveryDifferentLabel')}</div>
              </label>

              {deliveryDifferent && (
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('deliveryAddress')}</div>
                  <div className="space-y-3">
                    <input value={deliveryAddress} onChange={e => setDeliveryAddressWithDraft(e.target.value)} type="text" placeholder={t('streetPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={deliveryCity} onChange={e => setDeliveryCityWithDraft(e.target.value)} type="text" placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                      <input value={deliveryPostal} onChange={e => setDeliveryPostalWithDraft(e.target.value)} type="text" placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                    </div>
                    <select value={deliveryCountry} onChange={e => setDeliveryCountryWithDraft(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                      {countryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>
                </div>
              )}

              {canOfferVatInclusive && (
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('vatTreatment')}</div>
                  <label className="flex items-start gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                    <input type="checkbox" checked={vatInclusive} onChange={e => setVatInclusiveWithDraft(e.target.checked)} className="accent-cyan-400 mt-1" />
                    <div className="flex-1">
                      <div className="font-medium">{t('vatInclusiveLabel')}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{t('vatInclusiveExplanation')}</div>
                      {vatInclusive && vatTreatment.vatRate > 0 && <div className="text-[10px] text-amber-400 mt-1">{t('vatInclusiveWarning', { rate: Math.round(vatTreatment.vatRate * 100) })}</div>}
                    </div>
                  </label>
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('financingLabel')}</div>
                <div className="space-y-3">
                  <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                    <input type="radio" name="financing" value="full" checked={financing === 'full'} onChange={() => setFinancingWithDraft('full')} className="accent-cyan-400" />
                    <div className="flex-1">
                      <div className="font-medium">{t('payFull')}</div>
                      <div className="text-xs text-slate-400">{t('payFullDesc')}</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950" >
                    <input type="radio" name="financing" value="lease" checked={financing === 'lease'} disabled={!canLease} onChange={() => setFinancingWithDraft('lease')} className="accent-cyan-400" />
                    <div className="flex-1">
                      <div className="font-medium">{t('lease')}</div>
                      <div className="text-xs text-slate-400">{t('leaseDesc', { months: leaseMonths })}</div>
                    </div>
                  </label>
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('paymentMethod')}</div>
                <div className="space-y-3">
                  <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                    <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethodWithDraft('stripe')} className="accent-cyan-400" />
                    <div className="flex-1"><div className="font-medium">{t('card')}</div><div className="text-xs text-slate-400">{t('cardDesc')}</div></div>
                  </label>
                  <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                    <input type="radio" name="payment" value="sepa" checked={paymentMethod === 'sepa'} onChange={() => setPaymentMethodWithDraft('sepa')} className="accent-cyan-400" disabled={(financing === 'lease' && isOverSepaLimit(leaseMonthlyDisplay)) || (financing === 'full' && isOverSepaLimit(hwGross))} />
                    <div className="flex-1"><div className="font-medium">{t('sepa')}</div><div className="text-xs text-slate-400">{t('sepaDesc')}</div></div>
                  </label>
                  <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                    <input type="radio" name="payment" value="invoice" checked={paymentMethod === 'invoice'} disabled={!canUseInvoice} onChange={() => setPaymentMethodWithDraft('invoice')} className="accent-cyan-400" />
                    <div className="flex-1"><div className="font-medium">{t('invoice')}</div><div className="text-xs text-slate-400">{t('invoiceDesc')}</div></div>
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Bottom bar - fixed */}
        <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 flex justify-between items-center flex-shrink-0">
          <div className="min-w-0 flex-1 pr-4">
            {step === 1 ? (
              <VatPriceLine label={tcart('hardwareTotal')} amount={hwGross} net={hwNet} vat={hwVat} showBreakdown={showVatBreakdown} className="mb-1" />
            ) : (
              <VatPriceLine label={isLease ? t('monthlyTotalLabel', { months: leaseMonths }) : t('totalToPay')} amount={isLease ? leaseMonthlyDisplay : hwGross} net={isLease ? leaseNetDetails.monthlyTotal : hwNet} vat={isLease ? leaseMonthlyVatDisplay : hwVat} showBreakdown={showVatBreakdown} variant="summary" />
            )}
          </div>

          {step === 1 ? (
            <button onClick={handleNextStep} disabled={isSubmitting} className="shrink-0 px-9 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 disabled:opacity-60">{t('nextBtn')}</button>
          ) : (
            <div className="shrink-0 flex flex-col items-stretch gap-2 w-[148px]">
              <button onClick={handlePreviousStep} disabled={isSubmitting} className="px-4 py-2 border border-slate-600 text-slate-200 font-medium rounded-3xl text-xs hover:bg-slate-800">{t('previousBtn')}</button>
              <button onClick={handleCompleteOrder} disabled={isSubmitting || vatBlocksCheckout} className="px-4 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100">{t('completeBtn')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
