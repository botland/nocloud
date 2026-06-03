'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { calculateLease, isOverSepaLimit } from '@/lib/pricing';
import { CartItem } from '@/lib/types';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onOrderComplete: () => void;
}

export default function CheckoutModal({ cart, onClose, onOrderComplete }: Props) {
  const t = useTranslations('checkout');
  const tc = useTranslations();

  const [company, setCompany] = useState('');
  const [vat, setVat] = useState('');
  const [po, setPo] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [postal, setPostal] = useState('');
  const [country, setCountry] = useState('FR');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'sepa' | 'invoice'>('stripe');
  const [financing, setFinancing] = useState<'full' | 'lease'>('full');

  // Email collected here (part of checkout), kept in payload, transmitted to Stripe (pre-created Customer preferred; falls back to customer_email).
  const [email, setEmail] = useState('');


  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const servicesMonthly = cart.reduce((sum, item) => 
    sum + (item.services || []).reduce((s: number, p) => s + (p.price || 0) * (item.quantity || 1), 0)
  , 0);

  // Always compute lease preview numbers (independent of current financing choice).
  // Uses centralized calculateLease so client/server stay in sync.
  const leaseDetails = calculateLease(hardwareTotal, servicesMonthly);
  const leaseMonths = leaseDetails.months;
  const leaseMonthly = leaseDetails.monthlyTotal;

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

    if (paymentMethod === 'invoice') {
      // Keep the legacy B2B invoice fake flow (net 30). Use safe DOM construction (textContent / createElement) to avoid XSS from user fields.
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

      // icon
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

    // Real Stripe flow for 'stripe' / 'sepa'
    try {
      const payload = {
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
        // Redirect to Stripe hosted Checkout (direct payment or subscription)
        window.location.href = data.url;
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
              <input value={company} onChange={e => setCompany(e.target.value)} type="text" placeholder={t('companyPlaceholder')} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" />
              {/* Email collected as part of our checkout (kept + transmitted to Stripe for customer ownership). */}
              <input
                value={email}
                onChange={e => setEmail(e.target.value)}
                type="email"
                placeholder={t('emailPlaceholder')}
                className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500"
              />
              <div className="grid grid-cols-2 gap-3">
                <input value={vat} onChange={e => setVat(e.target.value)} type="text" placeholder={t('vatPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                <input value={po} onChange={e => setPo(e.target.value)} type="text" placeholder={t('poPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
              </div>
            </div>
          </div>

          {/* Billing Address - Added as requested */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('billingAddress')}</div>
            <div className="space-y-3">
              <input 
                value={address} 
                onChange={e => setAddress(e.target.value)}
                type="text" placeholder={t('streetPlaceholder')} 
                className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" 
              />
              <div className="grid grid-cols-2 gap-3">
                <input value={city} onChange={e => setCity(e.target.value)} type="text" placeholder={t('cityPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                <input value={postal} onChange={e => setPostal(e.target.value)} type="text" placeholder={t('postalPlaceholder')} className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
              </div>
              <select value={country} onChange={e => setCountry(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm">
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
                    setFinancing('full');
                    if (paymentMethod === 'sepa' && isOverSepaLimit(hardwareTotal)) setPaymentMethod('stripe');
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
                  onChange={() => {
                    setFinancing('lease');
                    if (paymentMethod === 'sepa' && isOverSepaLimit(leaseMonthly)) setPaymentMethod('stripe');
                  }} 
                  className="accent-cyan-400" 
                />
                <div className="flex-1">
                  <div className="font-medium">{t('lease')}</div>
                  <div className="text-xs text-slate-400">
                    {t('leaseDesc', { months: leaseMonths })} — {t('monthlyPayment', { amount: leaseMonthly, months: leaseMonths })}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{t('firstMonthNote')}</div>
                </div>
              </label>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">{t('paymentMethod')}</div>
            <div className="space-y-3">
              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} className="accent-cyan-400" />
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
                  onChange={() => setPaymentMethod('sepa')} 
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
                <input type="radio" name="payment" value="invoice" checked={paymentMethod === 'invoice'} onChange={() => setPaymentMethod('invoice')} className="accent-cyan-400" />
                <div className="flex-1">
                  <div className="font-medium">{t('invoice')}</div>
                  <div className="text-xs text-slate-400">{t('invoiceDesc')}</div>
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
