'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Product, CartItem } from '@/lib/types';

interface Props {
  product: Product;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
}

// Spec data: [translationKey, value]. Values are technical and stay the same across locales.
const specDefs = [
  ['inference', '60+ tokens/s (7B)'],
  ['models', 'Up to 13B'],
  ['memory', '24 GB'],
  ['storage', '1 TB NVMe'],
  ['formFactor', 'Compact desktop'],
] as const;

const specDefsStudio = [
  ['inference', 'High performance'],
  ['models', 'Up to 70B'],
  ['memory', '96 GB'],
  ['storage', '4 TB RAID'],
  ['formFactor', 'Desktop tower'],
] as const;

const specDefsForge = [
  ['inference', 'Enterprise scale'],
  ['models', '100B+ & multi-node'],
  ['memory', '256+ GB HBM'],
  ['storage', '8 TB+ Enterprise'],
  ['formFactor', 'Rackmount ready'],
] as const;

const specsById: Record<number, readonly (readonly [string, string])[]> = {
  0: specDefs,
  1: specDefsStudio,
  2: specDefsForge,
};

export default function ConfiguratorModal({ product, onClose, onAddToCart }: Props) {
  const t = useTranslations('configurator');

  const [managed, setManaged] = useState(false);
  const [backup, setBackup] = useState(false);
  const [quantity, setQuantity] = useState(1);

  const specs = specsById[product.id] || [];

  const managedUnit = 89;
  const backupUnit = 39;
  const managedPrice = managedUnit * quantity;
  const backupPrice = backupUnit * quantity;

  const selectedServices: { name: string; price: number }[] = [];
  if (managed) selectedServices.push({ name: t('managedCare'), price: managedUnit });
  if (backup) selectedServices.push({ name: t('secureVaultBackup'), price: backupUnit });

  const totalPrice = product.price * quantity;

  const handleAddToCart = () => {
    const item = {
      id: Date.now(),
      product,
      services: selectedServices,
      quantity,
      totalPrice,
    };
    onAddToCart(item);
  };

  const applianceLabel = quantity > 1 ? t('appliances') : t('appliance');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl overflow-hidden flex flex-col max-h-[92vh]" onClick={e => e.stopPropagation()}>
        <div className="px-7 pt-6 pb-5 border-b border-slate-800 flex justify-between items-start flex-shrink-0">
          <div>
            <div className="font-semibold text-2xl tracking-tight">{product.name}</div>
            <div className="text-xs uppercase tracking-[2px] text-cyan-400 font-bold mt-0.5">{product.tier}</div>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>
        
        <div className="p-7 overflow-y-auto flex-1">
          <div className="flex justify-between items-baseline mb-6">
            <div className="text-sm text-slate-400">{t('baseAppliance')}</div>
            <div className="text-3xl font-semibold tabular-nums">€{product.price}</div>
          </div>
          
          <div className="mb-7">
            <div className="uppercase text-xs tracking-widest text-slate-400 mb-3 font-medium">{t('keySpecs')}</div>
            <div className="text-sm">
              {specs.map((spec, idx) => (
                <div key={idx} className="flex justify-between py-[7px] border-b border-slate-800 last:border-none">
                  <span className="text-slate-400">{t(`specs.${spec[0]}`)}</span>
                  <span className="font-medium">{spec[1]}</span>
                </div>
              ))}
            </div>
          </div>
          
          {/* Quantity Selector */}
          <div className="mb-6">
            <div className="uppercase text-xs tracking-widest text-slate-400 mb-2 font-medium">{t('quantity')}</div>
            <div className="flex items-center gap-x-4">
              <button onClick={() => setQuantity(Math.max(1, quantity - 1))} className="w-9 h-9 flex items-center justify-center border border-slate-700 rounded-xl hover:bg-slate-800">−</button>
              <div className="font-mono text-xl w-8 text-center">{quantity}</div>
              <button onClick={() => setQuantity(quantity + 1)} className="w-9 h-9 flex items-center justify-center border border-slate-700 rounded-xl hover:bg-slate-800">+</button>
              <span className="text-sm text-slate-400 ml-2">{applianceLabel}</span>
            </div>
          </div>

          <div>
            <div className="uppercase text-xs tracking-widest text-slate-400 mb-3 font-medium">{t('optionalServices')}</div>
            <div className="space-y-3">
              <label className="flex gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950/60 transition-colors">
                <input type="checkbox" checked={managed} onChange={e => setManaged(e.target.checked)} className="accent-cyan-400 mt-1" />
                <div className="flex-1">
                  <div className="flex justify-between"><span className="font-medium">{t('managedCare')}</span> <span className="text-emerald-400 font-mono text-sm">€{managedPrice}/mo</span></div>
                  <div className="text-xs text-slate-400">{t('managedCareNote')}</div>
                </div>
              </label>
              <label className="flex gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950/60 transition-colors">
                <input type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} className="accent-cyan-400 mt-1" />
                <div className="flex-1">
                  <div className="flex justify-between"><span className="font-medium">{t('secureVaultBackup')}</span> <span className="text-sky-400 font-mono text-sm">€{backupPrice}/mo</span></div>
                  <div className="text-xs text-slate-400">{t('secureVaultBackupNote')}</div>
                </div>
              </label>
            </div>
          </div>
        </div>
        
        <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-xs text-slate-400">{t('totalToday')}</div>
            <div className="text-3xl font-semibold tabular-nums tracking-tighter">€{totalPrice}</div>
            <div className="text-[10px] text-slate-500">{t('recurringNote')}</div>
          </div>
          <button onClick={handleAddToCart} className="px-8 py-3.5 bg-white hover:bg-slate-100 text-slate-950 font-bold rounded-3xl text-sm">
            {t('addToCart')}
          </button>
        </div>
      </div>
    </div>
  );
}
