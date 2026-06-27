'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { calculateLease, isOverSepaLimit, isPbiAllowed, isInvoiceAllowed } from '@/lib/pricing';
import { CartItem, CheckoutFormDraft } from '@/lib/types';
import { determineVatTreatment, computeVatAmounts } from '@/lib/vat';
import { hasRecurringServices, recurringServicesMonthly, aggregatedRecurringLinesFromCart } from '@/lib/cart-services';
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
  const tc = useTranslations();

  const [company, setCompany] = useState(initialData?.company || '');
  const [email, setEmail] = useState(initialData?.email || '');
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
  const [vatInclusive, setVatInclusive] = useState(initialData?.vatInclusive || false);
  const [viesStatus, setViesStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid' | 'unavailable'>('idle');
  const [viesMessage, setViesMessage] = useState('');

  const updateDraft = (partial: Partial<CheckoutFormDraft>) => onDraftChange?.(partial);

  const setCompanyWithDraft = (v: string) => { setCompany(v); updateDraft({ company: v }); };
  const setEmailWithDraft = (v: string) => { setEmail(v); updateDraft({ email: v }); };
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
  const setPaymentMethodWithDraft = (v: any) => { setPaymentMethod(v); updateDraft({ paymentMethod: v }); };
  const setFinancingWithDraft = (v: any) => { setFinancing(v); updateDraft({ financing: v }); };
  const setRecurringPaymentMethodWithDraft = (v: any) => { setRecurringPaymentMethod(v); updateDraft({ recurringPaymentMethod: v }); };
  const setVatInclusiveWithDraft = (v: boolean) => { setVatInclusive(v); updateDraft({ vatInclusive: v }); };

  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const servicesMonthly = recurringServicesMonthly(cart);
  const cartHasRecurring = hasRecurringServices(cart);
  const recurringLines = aggregatedRecurringLinesFromCart(cart);

  const leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
  const leaseMonths = leaseDetails.months;
  const canLease = leaseDetails.isAllowed;
  const canUseInvoice = isPbiAllowed(hardwareTotal) && isInvoiceAllowed(financing, servicesMonthly);

  const isLease = financing === 'lease';

  useEffect(() => {
    const trimmed = vat.trim();
    if (!trimmed) { setViesStatus('idle'); setViesMessage(''); return; }

    const timer = setTimeout(async () => {
      setViesStatus('checking');
      try {
        const res = await fetch('/api/vat/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vatNumber: trimmed, country }) });
        const data = await res.json().catch(() => ({}));
        if (data.valid) {
          setViesStatus('valid');
          setViesMessage(data.name ? t('viesValidWithName', { name: data.name }) : t('viesValid'));
        } else if (res.status === 503) {
          setViesStatus('unavailable'); setViesMessage(t('viesUnavailable'));
        } else {
          setViesStatus('invalid'); setViesMessage(t('viesInvalid'));
        }
      } catch { setViesStatus('unavailable'); setViesMessage(t('viesUnavailable')); }
    }, 600);
    return () => clearTimeout(timer);
  }, [vat, country, t]);

  const vatTreatment = determineVatTreatment({ customerCountry: country, vatNumber: vat, viesValidated: viesStatus === 'valid' });
  const canOfferVatInclusive = vatTreatment.canOfferVatInclusive;
  const vatBlocksCheckout = !!vat.trim() && ['invalid','checking','unavailable'].includes(viesStatus);

  const showVatBreakdown = vatInclusive && vatTreatment.vatRate > 0;
  const vatPreview = computeVatAmounts(hardwareTotal, vatTreatment.vatRate, vatInclusive);

  const hwNet = hardwareTotal;
  const hwGross = showVatBreakdown ? vatPreview.gross : hwNet;

  const svcNet = servicesMonthly;
  const svcGross = showVatBreakdown ? computeVatAmounts(svcNet, vatTreatment.vatRate, true).gross : svcNet;

  const leaseUpfrontDisplay = showVatBreakdown ? computeVatAmounts(leaseDetails.upfrontAmount, vatTreatment.vatRate, true).gross : leaseDetails.upfrontAmount;
  const leaseMonthlyDisplay = showVatBreakdown ? computeVatAmounts(leaseDetails.monthlyTotal, vatTreatment.vatRate, true).gross : leaseDetails.monthlyTotal;

  useEffect(() => { if (!canOfferVatInclusive && vatInclusive) setVatInclusiveWithDraft(false); }, [canOfferVatInclusive, vatInclusive]);
  useEffect(() => { if (!canLease && financing === 'lease') setFinancingWithDraft('full'); }, [canLease, financing]);

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

  const goToStep = (targetStep: 1 | 2) => {
    if (targetStep === 1) {
      setStep(1);
      return;
    }
    if (validateStep1()) setStep(2);
  };

  const handleCompleteOrder = async () => {
    if (!validateStep1()) return;
    if (vat.trim() && viesStatus !== 'valid') {
      alert(viesMessage || t('viesInvalid'));
      return;
    }
    if ((financing === 'lease' && !canLease) || (paymentMethod === 'invoice' && !canUseInvoice)) {
      alert(t('validation'));
      return;
    }

    setIsSubmitting(true);

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
        paymentMethod,
        financing,
        locale,
        vatInclusive,
      };

      if (deliveryDifferent) {
        payload.deliveryAddress = deliveryAddress;
        payload.deliveryCity = deliveryCity;
        payload.deliveryPostal = deliveryPostal;
        payload.deliveryCountry = deliveryCountry;
      }
      if (paymentMethod === 'invoice' && cartHasRecurring) {
        payload.recurringPaymentMethod = recurringPaymentMethod;
      }

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create checkout session');
      }

      const data = await res.json();

      if (data.url) {
        window.location.href = data.url;
        return;
      }

      if (data.success) {
        onOrderComplete();
        return;
      }

      throw new Error('No checkout URL returned');
    } catch (e: any) {
      alert(`Unable to start payment: ${e.message || 'Please try again'}`);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl flex flex-col max-h-[92vh] overflow-hidden" 
        onClick={e => e.stopPropagation()}
      >
        {/* Single scrollable container for header + content + bottom */}
        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="px-7 py-5 border-b border-slate-800 sticky top-0 bg-slate-900 z-10 flex justify-between items-start">
            <div>
              <div className="font-semibold text-xl">{t('completeOrder')}</div>
              <div className="flex items-center gap-2 mt-2 text-xs">
                <button 
                  type="button" 
                  onClick={() => goToStep(1)} 
                  className={`transition-colors ${step === 1 ? 'text-cyan-400 font-medium' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  1. {t('stepInfo')}
                </button>
                <span className="text-slate-600">→</span>
                <button 
                  type="button" 
                  onClick={() => goToStep(2)} 
                  className={`transition-colors ${step === 2 ? 'text-cyan-400 font-medium' : 'text-slate-500 hover:text-slate-300'}`}
                >
                  2. {t('stepPayment')}
                </button>
              </div>
            </div>
            <button onClick={onClose} className="text-2xl text-slate-400 hover:text-slate-200">×</button>
          </div>

          {/* Form Content */}
          <div className="p-7 space-y-6">
            {step === 1 && (
              <>
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('companyInfo')}</div>
                  <div className="space-y-3">
                    <input value={company} onChange={e => setCompanyWithDraft(e.target.value)} placeholder={t('companyPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" />
                    <input value={email} onChange={e => setEmailWithDraft(e.target.value)} type="email" placeholder={t('emailPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <input value={vat} onChange={e => setVatWithDraft(e.target.value)} placeholder={t('vatPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                        {vat.trim() && (
                          <div className={`text-[10px] mt-1 ${viesStatus === 'valid' ? 'text-emerald-400' : viesStatus === 'checking' ? 'text-slate-400' : 'text-amber-400'}`}>
                            {viesStatus === 'checking' && t('viesChecking')}
                            {viesStatus === 'valid' && (viesMessage || t('viesValid'))}
                            {viesStatus === 'invalid' && (viesMessage || t('viesInvalid'))}
                            {viesStatus === 'unavailable' && t('viesUnavailable')}
                          </div>
                        )}
                      </div>
                      <input value={po} onChange={e => setPoWithDraft(e.target.value)} placeholder={t('poPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('billingAddress')}</div>
                  <div className="space-y-3">
                    <input value={address} onChange={e => setAddressWithDraft(e.target.value)} placeholder={t('streetPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={city} onChange={e => setCityWithDraft(e.target.value)} placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                      <input value={postal} onChange={e => setPostalWithDraft(e.target.value)} placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
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
                      <input value={deliveryAddress} onChange={e => setDeliveryAddressWithDraft(e.target.value)} placeholder={t('streetPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                      <div className="grid grid-cols-2 gap-3">
                        <input value={deliveryCity} onChange={e => setDeliveryCityWithDraft(e.target.value)} placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                        <input value={deliveryPostal} onChange={e => setDeliveryPostalWithDraft(e.target.value)} placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                      </div>
                      <select value={deliveryCountry} onChange={e => setDeliveryCountryWithDraft(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
                        {countryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>
                    </div>
                  </div>
                )}

                {canOfferVatInclusive && (
                  <label className="flex items-start gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                    <input type="checkbox" checked={vatInclusive} onChange={e => setVatInclusiveWithDraft(e.target.checked)} className="accent-cyan-400 mt-1" />
                    <div className="flex-1">
                      <div className="font-medium">{t('vatInclusiveLabel')}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{t('vatInclusiveExplanation')}</div>
                      {vatInclusive && vatTreatment.vatRate > 0 && (
                        <div className="text-[10px] text-amber-400 mt-1">{t('vatInclusiveWarning', { rate: Math.round(vatTreatment.vatRate * 100) })}</div>
                      )}
                    </div>
                  </label>
                )}
              </>
            )}

            {step === 2 && (
              <>
                <div>
                  <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('financingLabel')}</div>
                  <div className="space-y-3">
                    <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                      <input type="radio" name="financing" checked={financing === 'full'} onChange={() => setFinancingWithDraft('full')} className="accent-cyan-400" />
                      <div className="flex-1">
                        <div className="font-medium">{t('payFull')}</div>
                        <div className="text-xs text-slate-400">{t('payFullDesc')}</div>
                      </div>
                    </label>

                    <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                      <input type="radio" name="financing" checked={financing === 'lease'} disabled={!canLease} onChange={() => setFinancingWithDraft('lease')} className="accent-cyan-400" />
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
                      <input type="radio" name="payment" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethodWithDraft('stripe')} className="accent-cyan-400" />
                      <div className="flex-1">
                        <div className="font-medium flex items-center gap-x-2">{t('card')} <span className="text-[10px] px-2 py-px bg-slate-800 rounded">{t('cardTag')}</span></div>
                        <div className="text-xs text-slate-400">{t('cardDesc')}</div>
                      </div>
                    </label>

                    <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                      <input type="radio" name="payment" checked={paymentMethod === 'sepa'} onChange={() => setPaymentMethodWithDraft('sepa')} className="accent-cyan-400" disabled={(financing === 'lease' && isOverSepaLimit(leaseMonthlyDisplay)) || (financing === 'full' && isOverSepaLimit(hwGross))} />
                      <div className="flex-1">
                        <div className="font-medium">{t('sepa')}</div>
                        <div className="text-xs text-slate-400">{t('sepaDesc')}</div>
                      </div>
                    </label>

                    <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                      <input type="radio" name="payment" checked={paymentMethod === 'invoice'} disabled={!canUseInvoice} onChange={() => setPaymentMethodWithDraft('invoice')} className="accent-cyan-400" />
                      <div className="flex-1">
                        <div className="font-medium">{t('invoice')}</div>
                        <div className="text-xs text-slate-400">{t('invoiceDesc')}</div>
                      </div>
                    </label>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Bottom summary + actions (now inside the scroll container) */}
          <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 sticky bottom-0">
            <div className="flex justify-between items-center">
              <div className="min-w-0 flex-1 pr-4">
                {step === 1 ? (
                  <VatPriceLine label={tc('cart.hardwareTotal')} amount={hwGross} showBreakdown={showVatBreakdown} />
                ) : (
                  <div>
                    <VatPriceLine 
                      label={isLease ? t('monthlyTotalLabel', { months: leaseMonths }) : t('totalToPay')} 
                      amount={isLease ? leaseMonthlyDisplay : hwGross} 
                      showBreakdown={showVatBreakdown} 
                      variant="summary" 
                    />
                    {isLease && <div className="text-[10px] text-slate-500 mt-1">{t('firstMonthNote')}</div>}
                  </div>
                )}
              </div>

              {step === 1 ? (
                <button onClick={() => goToStep(2)} className="shrink-0 px-8 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100">
                  {t('nextBtn')}
                </button>
              ) : (
                <div className="shrink-0 flex flex-col items-stretch gap-2 w-[148px]">
                  <button onClick={() => setStep(1)} className="px-4 py-2 border border-slate-600 text-slate-200 font-medium rounded-3xl text-xs hover:bg-slate-800">
                    {t('previousBtn')}
                  </button>
                  <button 
                    onClick={handleCompleteOrder} 
                    disabled={isSubmitting || vatBlocksCheckout} 
                    className="px-4 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {t('completeBtn')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
