'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { calculateLease, isOverSepaLimit, isLeaseAllowed, isPbiAllowed, isInvoiceAllowed, LEASE_MIN, LEASE_MAX, PBI_MIN, PBI_MAX } from '@/lib/pricing';
import { CartItem, CheckoutFormDraft } from '@/lib/types';

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
  const tc = useTranslations();

  // Initialize from persisted draft if present (e.g. user filled form, went to Stripe, canceled).
  const [company, setCompany] = useState(initialData?.company || '');
  const [vat, setVat] = useState(initialData?.vatNumber || '');
  const [po, setPo] = useState(initialData?.poNumber || '');
  const [address, setAddress] = useState(initialData?.address || '');
  const [city, setCity] = useState(initialData?.city || '');
  const [postal, setPostal] = useState(initialData?.postal || '');
  const [country, setCountry] = useState(initialData?.country || 'FR');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'sepa' | 'invoice'>(initialData?.paymentMethod || 'stripe');
  const [financing, setFinancing] = useState<'full' | 'lease'>(initialData?.financing || 'full');

  // When paymentMethod==='invoice' AND the cart contains recurring services, the user picks (inside the
  // invoice box) how the recurring services will be paid: 'stripe' (card) or 'sepa'. The main hardware/upfront
  // still uses the Net-30 invoice; this only affects creation of automatic service subs (via a mode:'setup' session).
  const [recurringPaymentMethod, setRecurringPaymentMethod] = useState<'stripe' | 'sepa'>(initialData?.recurringPaymentMethod || 'stripe');

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
  const setPaymentMethodWithDraft = (v: 'stripe' | 'sepa' | 'invoice') => { setPaymentMethod(v); updateDraft({ paymentMethod: v }); };
  const setFinancingWithDraft = (v: 'full' | 'lease') => { setFinancing(v); updateDraft({ financing: v }); };
  const setRecurringPaymentMethodWithDraft = (v: 'stripe' | 'sepa') => { setRecurringPaymentMethod(v); updateDraft({ recurringPaymentMethod: v }); };
  const setEmailWithDraft = (v: string) => { setEmail(v); updateDraft({ email: v }); };


  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const servicesMonthly = cart.reduce((sum, item) => 
    sum + (item.services || []).reduce((s: number, p) => s + (p.price || 0) * (item.quantity || 1), 0)
  , 0);

  // Always compute lease preview numbers (independent of current financing choice).
  // Uses centralized calculateLease so client/server stay in sync.
  const leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
  const leaseMonths = leaseDetails.months;
  const leaseMonthly = leaseDetails.monthlyTotal;
  const leaseUpfront = leaseDetails.upfrontAmount;

  const canLease = leaseDetails.isAllowed;
  const canPbi = isPbiAllowed(hardwareTotal);
  const canInvoicePolicy = isInvoiceAllowed(financing, servicesMonthly);
  const canUseInvoice = canPbi && canInvoicePolicy;

  // Current selection
  const isLease = financing === 'lease';

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

  const handleCompleteOrder = async () => {
    if (!company || !email || !address || !city) {
      alert(t('validation'));
      return;
    }

    if ((financing === 'lease' && !canLease) || (paymentMethod === 'invoice' && !canUseInvoice)) {
      alert(t('validation'));
      return;
    }

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
        paymentMethod,
        financing,
        locale,
      };
      if (paymentMethod === 'invoice' && servicesMonthly > 0) {
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
        const v4 = document.createElement('span'); v4.className = 'font-semibold'; v4.textContent = `€${hardwareTotal}`;
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
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        
        <div className="px-7 py-5 border-b border-slate-800 flex justify-between">
          <div className="font-semibold text-xl">{t('completeOrder')}</div>
          <button onClick={onClose} className="text-2xl text-slate-400">×</button>
        </div>

        <div className="p-7 space-y-6 max-h-[68vh] overflow-y-auto">
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
                <input value={vat} onChange={e => setVatWithDraft(e.target.value)} type="text" placeholder={t('vatPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
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

          {/* Financing / Payment Terms (new for direct / recurring / leasing) */}
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
                    if (paymentMethod === 'sepa' && isOverSepaLimit(hardwareTotal)) setPaymentMethodWithDraft('stripe');
                    if (paymentMethod === 'invoice' && !canPbi) setPaymentMethodWithDraft('stripe');
                    // Note: full + invoice + services is now supported (send_invoice service subs + first periods on the net30 invoice).
                  }} 
                  className="accent-cyan-400" 
                />
                <div className="flex-1">
                  <div className="font-medium">{t('payFull')}</div>
                  <div className="text-xs text-slate-400">{t('payFullDesc')} — €{hardwareTotal}{servicesMonthly > 0 ? ` + €${servicesMonthly}${tc('common.recurringSuffixShort')}` : ''}</div>
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
                      if (paymentMethod === 'sepa' && isOverSepaLimit(leaseMonthly)) setPaymentMethodWithDraft('stripe');
                      if (paymentMethod === 'invoice') setPaymentMethodWithDraft('stripe'); // lease never allows invoice under policy
                    } else {
                      setFinancingWithDraft('full');
                      if (paymentMethod === 'invoice' && !canPbi) setPaymentMethodWithDraft('stripe');
                      // full + invoice + services now supported; no force needed here.
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
                    <div className="text-xs text-emerald-400 mt-0.5">
                      {t('upfrontDueToday', { amount: leaseUpfront })} + {t('monthlyPayment', { amount: leaseMonthly, months: leaseMonths })}
                    </div>
                  )}
                  <div className="text-[10px] text-slate-500 mt-0.5">{t('firstMonthNote')}</div>
                  {!canLease && (
                    <div className="text-[10px] text-amber-400 mt-0.5">{t('leaseRangeNote', { min: LEASE_MIN, max: LEASE_MAX })}</div>
                  )}
                </div>
              </label>
            </div>
          </div>

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
                  disabled={ (financing === 'lease' && isOverSepaLimit(leaseMonthly)) || (financing === 'full' && isOverSepaLimit(hardwareTotal)) }
                />
                <div className="flex-1">
                  <div className="font-medium">{t('sepa')}</div>
                  <div className="text-xs text-slate-400">
                    {t('sepaDesc')}
                    { ( (financing === 'lease' && isOverSepaLimit(leaseMonthly)) || (financing === 'full' && isOverSepaLimit(hardwareTotal)) ) && (
                      <span className="text-amber-400 ml-1">(max €10,000 — choose card or reduce order)</span>
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
                  {!canPbi && (
                    <div className="text-[10px] text-amber-400 mt-0.5">{t('invoiceRangeNote', { min: PBI_MIN, max: PBI_MAX })}</div>
                  )}
                  {canPbi && !canInvoicePolicy && (
                    <div className="text-[10px] text-amber-400 mt-0.5">{t('invoicePolicyNote')}</div>
                  )}

                  {/* When the user chooses Pay by Invoice for the hardware/upfront but the order has recurring services,
                      they must pick (inside this box) how the *recurring* part is paid: card or SEPA.
                      The backend will create the Net-30 invoice for hardware and a mode:'setup' Checkout for the
                      recurring PM so that service subs are automatic (charge_automatically) instead of send_invoice. */}
                  {servicesMonthly > 0 && paymentMethod === 'invoice' && (
                    <div className="mt-3 pl-4 border-l-2 border-slate-600 space-y-2">
                      <div className="text-xs font-medium text-slate-300">{t('recurringPaymentForServices')}</div>
                      <label className="flex items-center gap-x-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="recurringPayment"
                          value="stripe"
                          checked={recurringPaymentMethod === 'stripe'}
                          onChange={() => setRecurringPaymentMethodWithDraft('stripe')}
                          className="accent-cyan-400"
                        />
                        <span className="font-medium flex items-center gap-x-1">
                          {t('recurringCard')} <span className="text-[10px] px-1.5 py-px bg-slate-800 rounded">{t('recurringCardTag')}</span>
                        </span>
                      </label>
                      <label className="flex items-center gap-x-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="recurringPayment"
                          value="sepa"
                          checked={recurringPaymentMethod === 'sepa'}
                          onChange={() => setRecurringPaymentMethodWithDraft('sepa')}
                          disabled={isOverSepaLimit(servicesMonthly)}
                          className="accent-cyan-400"
                        />
                        <span>
                          {t('recurringSepa')}
                          <span className="text-xs text-slate-400 block">{t('recurringSepaDesc')}</span>
                          {isOverSepaLimit(servicesMonthly) && (
                            <span className="text-amber-400 text-[10px]">(max €10,000 — choose card)</span>
                          )}
                        </span>
                      </label>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 flex justify-between items-center">
          <div>
            <div className="text-xs text-slate-400">
              {isLease 
                ? t('monthlyTotalLabel', { months: leaseMonths }) 
                : t('totalToPay')}
            </div>
            <div className="text-2xl font-semibold tabular-nums">€{isLease ? leaseMonthly : hardwareTotal}</div>
            {isLease && (
              <div className="text-[10px] text-emerald-400">{t('upfrontDueToday', { amount: leaseUpfront })}</div>
            )}
            {!isLease && servicesMonthly > 0 && (
              <div className="text-[10px] text-emerald-400">+ €{servicesMonthly}{tc('common.recurringSuffix')}</div>
            )}
            {isLease && <div className="text-[10px] text-slate-500">{t('firstMonthNote')}</div>}
          </div>
          <button onClick={handleCompleteOrder} className="px-9 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 flex items-center gap-x-2">
            {t('completeBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}
