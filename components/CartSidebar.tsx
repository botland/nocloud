'use client';

import { useTranslations } from 'next-intl';
import { CartItem } from '@/lib/types';
import { BRAND_NAME } from '@/lib/brand';
import { formatHardwareCustomization } from '@/lib/pricing';

interface Props {
  cart: CartItem[];
  onClose: () => void;
  onCheckout: () => void;
  onRemoveItem: (id: number) => void;
  onUpdateQuantity?: (id: number, newQuantity: number) => void;
  onEditItem?: (item: CartItem) => void;
}

export default function CartSidebar({ cart, onClose, onCheckout, onRemoveItem, onUpdateQuantity, onEditItem }: Props) {
  const t = useTranslations('cart');
  const tc = useTranslations();

  const hardwareTotal = cart.reduce((sum, item) => sum + item.totalPrice, 0);

  const servicesMonthly = cart.reduce((sum, item) => 
    sum + (item.services || []).reduce((s: number, p) => s + (p.price || 0) * (item.quantity || 1), 0)
  , 0);

  const updateQty = (id: number, newQty: number) => {
    if (newQty < 1) return;
    if (onUpdateQuantity) onUpdateQuantity(id, newQty);
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[110] flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-slate-900 h-full flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-6 flex justify-between items-center border-b border-slate-800">
          <div className="font-semibold text-xl">{t('yourOrder')}</div>
          <button onClick={onClose} className="text-2xl leading-none text-slate-400 hover:text-white">×</button>
        </div>

        <div className="flex-1 p-6 overflow-auto space-y-5 text-sm">
          {cart.length === 0 ? (
            <div className="text-center py-12 text-slate-400">{t('empty')}</div>
          ) : (
            cart.map((item) => {
              const qty = item.quantity || 1;
              return (
                <div key={item.id} className="border border-slate-700 rounded-2xl p-4">
                  <div className="flex justify-between">
                    <div>
                      <div className="font-semibold">{item.product.name}</div>
                      <div className="text-xs text-slate-400">{t('itemLabel', { brand: BRAND_NAME, name: item.product.name, qty })}</div>
                      {item.customization && (
                        <div className="text-[10px] text-slate-500 mt-0.5">{formatHardwareCustomization(item.customization)}</div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-semibold">{tc('common.price', { amount: item.totalPrice })}</div>
                      {item.services?.length > 0 && (
                        <div className="text-xs text-emerald-400">+ {tc('common.price', { amount: (item.services || []).reduce((s: number, p) => s + (p.price || 0), 0) * qty })}{tc('common.perMonth')}</div>
                      )}
                    </div>
                  </div>

                  <div className="flex justify-between">

                    {/* Quantity controls in cart */}
                    <div className="flex items-center gap-x-2 mt-3">
                      <button onClick={() => updateQty(item.id, qty - 1)} className="w-7 h-7 text-xs border border-slate-600 rounded hover:bg-slate-800">−</button>
                      <span className="font-mono text-sm px-2">{qty}</span>
                      <button onClick={() => updateQty(item.id, qty + 1)} className="w-7 h-7 text-xs border border-slate-600 rounded hover:bg-slate-800">+</button>
                    </div>

                    <div className="text-right cursor-pointer" onClick={() => { if (onEditItem) { onClose(); onEditItem(item); } }}>
                    {onEditItem && (
                      <div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); onClose(); onEditItem(item); }} 
                          className="ml-2 text-cyan-400 text-xs hover:text-cyan-500"
                        >
                        {t('edit')}
                        </button>
                      </div>
                      )}
                      <div>
                        <button
                          onClick={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                          className="ml-2 text-red-400 text-xs hover:text-red-500"
                        >
                        {t('remove')}
                        </button>
                      </div>
                    </div>
                  </div>

                  {item.services?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-700 text-xs space-y-1">
                      {item.services.map((s, i) => (
                        <div key={i} className="flex justify-between text-emerald-300">
                          <span>{s.name}</span>
                          <span>{tc('common.price', { amount: s.price * qty })}{tc('common.perMonth')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-6 border-t border-slate-800 bg-slate-950">
            <div className="flex justify-between text-sm mb-1 px-1">
              <span className="text-slate-400">{t('hardwareTotal')}</span>
              <span className="font-semibold tabular-nums">{tc('common.price', { amount: hardwareTotal })}</span>
            </div>
            <div className="flex justify-between text-xs px-1 text-slate-400 mb-5">
              <span>{t('servicesMonthly')}</span>
              <span>{tc('common.price', { amount: servicesMonthly })}</span>
            </div>
            
            <button onClick={onCheckout} className="w-full py-4 bg-white text-slate-950 font-bold rounded-3xl hover:bg-slate-100 transition-colors flex items-center justify-center gap-x-2 text-sm">
              {t('proceedCheckout')}
            </button>
            <div className="text-center text-[10px] text-slate-500 mt-3">{t('secureNote')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
