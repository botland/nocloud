'use client';

import { useState } from 'react';
import { CartItem } from '@/lib/types';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onCheckout: () => void;
}

export default function CartSidebar({ cart, onClose, onCheckout }: Props) {
  const [loading, setLoading] = useState(false);

  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const handleStripeCheckout = async () => {
    setLoading(true);
    
    // In real app, collect B2B info here or in a previous step
    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart,
        company: "Acme Corp", // Replace with real form data
        vatNumber: "FR123456789",
      }),
    });

    const data = await response.json();
    
    if (data.url) {
      window.location.href = data.url; // Redirect to Stripe Checkout
    }
    
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[110] flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 flex justify-between items-center border-b border-slate-800">
          <h2 className="text-xl font-semibold">Your Cart</h2>
          <button onClick={onClose} className="text-2xl">×</button>
        </div>

        <div className="flex-1 p-6 overflow-auto">
          {cart.length === 0 ? (
            <p className="text-slate-400">Your cart is empty.</p>
          ) : (
            cart.map((item, index) => (
              <div key={index} className="mb-4 p-4 border border-slate-700 rounded-2xl">
                <div className="font-semibold">{item.product.name}</div>
                <div className="text-sm text-slate-400">€{item.totalPrice}</div>
                {item.services.length > 0 && (
                  <div className="mt-2 text-xs text-emerald-400">
                    + {item.services.map(s => s.name).join(', ')}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="p-6 border-t border-slate-800">
          <div className="flex justify-between mb-4">
            <span>Total</span>
            <span className="font-semibold text-xl">€{hardwareTotal}</span>
          </div>
          
          <button 
            onClick={handleStripeCheckout}
            disabled={loading || cart.length === 0}
            className="w-full py-4 bg-white text-slate-950 font-bold rounded-3xl disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Checkout with Stripe'}
          </button>
          
          <p className="text-center text-xs text-slate-500 mt-3">Secure payment • SEPA &amp; Cards supported</p>
        </div>
      </div>
    </div>
  );
}
