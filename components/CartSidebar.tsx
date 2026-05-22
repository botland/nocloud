'use client';

import { useState } from 'react';
import { CartItem } from '@/lib/types';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onCheckout: () => void;
  onRemoveItem: (id: number) => void;
}

export default function CartSidebar({ cart, onClose, onCheckout, onRemoveItem }: Props) {
  const [loading, setLoading] = useState(false);

  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);
  const hasRecurring = cart.some(item => item.services.some(s => s.price > 0 && s.name.includes('mo')));

  const handleStripeCheckout = async () => {
    if (cart.length === 0) return;
    setLoading(true);
    
    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart,
          company: "Demo B2B Corp",
          vatNumber: "FR12345678901",
        }),
      });

      const data = await response.json();
      
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('Checkout session created. (Demo)');
      }
    } catch (e) {
      console.error(e);
      alert('Unable to start checkout. Please try again.');
    }
    
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[110] flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 flex justify-between items-center border-b border-slate-800">
          <div>
            <h2 className="text-xl font-semibold">Your Cart</h2>
            <p className="text-xs text-slate-400">{cart.length} item{cart.length !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>

        <div className="flex-1 p-6 overflow-auto space-y-4">
          {cart.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-slate-400">Your cart is empty.</p>
              <button onClick={onClose} className="mt-4 text-sm text-cyan-400">Continue shopping →</button>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="p-4 border border-slate-700 rounded-2xl">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-semibold text-lg tracking-tight">{item.product.name}</div>
                    <div className="text-xs text-slate-400">{item.product.tier} • €{item.product.price} base</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">€{item.totalPrice}</div>
                    <button 
                      onClick={() => onRemoveItem(item.id)}
                      className="text-xs text-red-400 hover:text-red-500 mt-1"
                    >
                      Remove
                    </button>
                  </div>
                </div>

                {item.services.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-800 text-xs">
                    <div className="text-emerald-400 mb-1 font-medium">Included services:</div>
                    {item.services.map((service, idx) => (
                      <div key={idx} className="flex justify-between text-slate-300">
                        <span>• {service.name}</span>
                        <span className="font-mono">€{service.price}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-6 border-t border-slate-800 bg-slate-950">
            <div className="flex justify-between mb-1 text-sm">
              <span className="text-slate-400">Hardware & setup total</span>
              <span className="font-semibold text-xl tabular-nums">€{hardwareTotal}</span>
            </div>
            {hasRecurring && <p className="text-[10px] text-emerald-400 mb-4">+ selected recurring services billed monthly</p>}
            
            <button 
              onClick={handleStripeCheckout}
              disabled={loading || cart.length === 0}
              className="w-full py-4 bg-white text-slate-950 font-bold rounded-3xl disabled:opacity-50 hover:bg-slate-100 transition-colors flex items-center justify-center gap-x-2"
            >
              {loading ? 'Connecting to Stripe...' : 'Checkout with Stripe'}
            </button>
            
            <p className="text-center text-xs text-slate-500 mt-3">Secure • SEPA, Cards • B2B invoicing available</p>
          </div>
        )}
      </div>
    </div>
  );
}
