'use client';

import { useState } from 'react';

interface Props {
  cart: any[];
  onClose: () => void;
  onOrderComplete: () => void;
}

export default function CheckoutModal({ cart, onClose, onOrderComplete }: Props) {
  const [company, setCompany] = useState('');
  const [vat, setVat] = useState('');
  const [po, setPo] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'stripe' | 'sepa' | 'invoice'>('stripe');

  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const handleCompleteOrder = () => {
    if (!company) {
      alert('Please enter your company name');
      return;
    }
    
    // Simulate order completion
    onOrderComplete();
    
    const successMessage = paymentMethod === 'invoice' 
      ? `Thank you, ${company}! Your order has been registered. You will receive an invoice with payment instructions shortly.`
      : paymentMethod === 'sepa'
      ? `SEPA Direct Debit has been set up for ${company}. You will receive a confirmation email.`
      : `Payment successful via Stripe for ${company}. You will receive order confirmation and tracking.`;

    // Show success toast
    const successDiv = document.createElement('div');
    successDiv.className = `fixed inset-0 bg-black/90 z-[200] flex items-center justify-center p-6`;
    successDiv.innerHTML = `
      <div class="bg-slate-900 border border-slate-700 max-w-md w-full rounded-3xl p-8 text-center">
        <div class="mx-auto w-16 h-16 bg-emerald-900/30 rounded-full flex items-center justify-center mb-6">
          <i class="fa-solid fa-check text-emerald-400 text-4xl"></i>
        </div>
        <h3 class="text-2xl font-semibold tracking-tight mb-3">Order confirmed!</h3>
        <p class="text-slate-400 mb-6">${successMessage}</p>
        
        <div class="text-left bg-slate-950 p-4 rounded-2xl text-sm mb-6">
          <div class="flex justify-between py-1"><span class="text-slate-400">Order #</span> <span class="font-mono">NC-${Date.now().toString().slice(-8)}</span></div>
          <div class="flex justify-between py-1"><span class="text-slate-400">Payment</span> <span class="capitalize">${paymentMethod}</span></div>
          <div class="flex justify-between py-1"><span class="text-slate-400">Total</span> <span class="font-semibold">€${hardwareTotal}</span></div>
        </div>
        
        <button onclick="this.closest('.fixed').remove(); window.location.reload()" 
                class="w-full py-3.5 bg-white text-slate-950 font-bold rounded-3xl">Return to homepage</button>
      </div>
    `;
    document.body.appendChild(successDiv);
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[120] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden" onClick={e => e.stopPropagation()}>
        
        <div className="px-7 py-5 border-b border-slate-800 flex justify-between">
          <div className="font-semibold text-xl">Complete your order</div>
          <button onClick={onClose} className="text-2xl text-slate-400">×</button>
        </div>

        <div className="p-7 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Company Info */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">COMPANY INFORMATION</div>
            <div className="space-y-3">
              <input 
                value={company} 
                onChange={e => setCompany(e.target.value)}
                type="text" placeholder="Company name" 
                className="w-full bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-cyan-500" 
              />
              <div className="grid grid-cols-2 gap-3">
                <input value={vat} onChange={e => setVat(e.target.value)} type="text" placeholder="VAT / SIRET number" className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
                <input value={po} onChange={e => setPo(e.target.value)} type="text" placeholder="PO number (optional)" className="bg-slate-950 border border-slate-700 rounded-2xl px-4 py-3 text-sm" />
              </div>
            </div>
          </div>

          {/* Payment Method */}
          <div>
            <div className="text-xs uppercase tracking-widest text-slate-400 mb-2.5 font-medium">PAYMENT METHOD</div>
            <div className="space-y-3">
              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input type="radio" name="payment" value="stripe" checked={paymentMethod === 'stripe'} onChange={() => setPaymentMethod('stripe')} className="accent-cyan-400" />
                <div className="flex-1">
                  <div className="font-medium flex items-center gap-x-2">Credit / Debit card <span className="text-[10px] px-2 py-px bg-slate-800 rounded">Stripe</span></div>
                  <div className="text-xs text-slate-400">Secure payment powered by Stripe • 3D Secure</div>
                </div>
              </label>

              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input type="radio" name="payment" value="sepa" checked={paymentMethod === 'sepa'} onChange={() => setPaymentMethod('sepa')} className="accent-cyan-400" />
                <div className="flex-1">
                  <div className="font-medium">SEPA Direct Debit</div>
                  <div className="text-xs text-slate-400">Popular in Europe • No card needed</div>
                </div>
              </label>

              <label className="flex items-center gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950">
                <input type="radio" name="payment" value="invoice" checked={paymentMethod === 'invoice'} onChange={() => setPaymentMethod('invoice')} className="accent-cyan-400" />
                <div className="flex-1">
                  <div className="font-medium">Pay by Invoice (B2B)</div>
                  <div className="text-xs text-slate-400">Net 30 • Common for European companies</div>
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 flex justify-between items-center">
          <div>
            <div className="text-xs text-slate-400">Total to pay today</div>
            <div className="text-2xl font-semibold tabular-nums">€{hardwareTotal}</div>
          </div>
          <button 
            onClick={handleCompleteOrder}
            className="px-9 py-[14px] bg-white text-slate-950 font-bold rounded-3xl text-sm hover:bg-slate-100 flex items-center gap-x-2"
          >
            Complete order
          </button>
        </div>
      </div>
    </div>
  );
}
