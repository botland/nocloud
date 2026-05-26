'use client';

import { CartItem } from '@/lib/types';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onCheckout: () => void;
  onRemoveItem: (id: number) => void;
}

export default function CartSidebar({ cart, onClose, onCheckout, onRemoveItem }: Props) {
  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  return (
    <div className="fixed inset-0 bg-black/70 z-[110] flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 flex justify-between items-center border-b border-slate-800">
          <div className="font-semibold text-xl">Your order</div>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white">×</button>
        </div>

        <div className="flex-1 p-6 overflow-auto space-y-5 text-sm">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-slate-400">Your cart is empty</div>
          ) : (
            cart.map((item, idx) => (
              <div key={idx} className="border border-slate-700 rounded-2xl p-4">
                <div className="flex justify-between">
                  <div>
                    <div className="font-semibold">{item.product.name}</div>
                    <div className="text-xs text-slate-400">NoCloud {item.product.name}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">€{item.totalPrice}</div>
                    <button onClick={() => onRemoveItem(item.id)} className="text-red-400 text-xs hover:text-red-500">Remove</button>
                  </div>
                </div>
                {item.services.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-700 text-xs space-y-1">
                    {item.services.map((s: any, i: number) => (
                      <div key={i} className="flex justify-between text-emerald-300">
                        <span>{s.name}</span>
                        <span>€{s.price}/mo</span>
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
            <div className="flex justify-between text-sm mb-1 px-1">
              <span className="text-slate-400">Hardware total</span>
              <span className="font-semibold tabular-nums">€{hardwareTotal}</span>
            </div>
            <div className="flex justify-between text-xs px-1 text-slate-400 mb-5">
              <span>Services (monthly)</span>
              <span>see configurator</span>
            </div>
            
            <button 
              onClick={onCheckout}
              className="w-full py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-colors flex items-center justify-center gap-x-2 text-sm"
            >
              Proceed to secure checkout
            </button>
            
            <div className="text-center text-[10px] text-slate-500 mt-3">Secure • VAT handled • European invoicing</div>
          </div>
        )}
      </div>
    </div>
  );
}
