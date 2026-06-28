'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Product, CartItem } from '@/lib/types';
import {
  getSpecOptions,
  getDefaultOption,
  type HardwareCustomization,
} from '@/lib/pricing';
import { resolveHardwarePrice, resolveServicePrice } from '@/lib/promotions';
import PromoBadge from '@/components/PromoBadge';
import PromoPrice from '@/components/PromoPrice';
import RecurringServicesSummary from '@/components/RecurringServicesSummary';

interface Props {
  product: Product;
  onClose: () => void;
  onAddToCart: (item: CartItem) => void;
  editingItem?: CartItem;
}

// Static (non-customizable) rows per tier for the KEY SPECIFICATIONS list.
// The upgradable dimensions (ram/vram/disk) are rendered as live <select>s below instead.
const staticRowsById: Record<number, Array<{ key: string; value: string }>> = {
  0: [ // edge
    { key: 'inference', value: '60+ tokens/s (7B)' },
    { key: 'models', value: 'Up to 13B' },
    { key: 'formFactor', value: 'Compact desktop' },
  ],
  1: [ // studio
    { key: 'inference', value: 'High performance' },
    { key: 'models', value: 'Up to 70B' },
    { key: 'formFactor', value: 'Desktop tower' },
  ],
  2: [ // forge
    { key: 'inference', value: 'Enterprise scale' },
    { key: 'models', value: '100B+ & multi-node' },
    { key: 'formFactor', value: 'Rackmount ready' },
  ],
};

const upgradableKeys = ['ram', 'vram', 'disk'] as const;

export default function ConfiguratorModal({ product, onClose, onAddToCart, editingItem }: Props) {
  const t = useTranslations('configurator');
  const tc = useTranslations();

  const slug = product.slug as 'edge' | 'studio' | 'forge';

  // Initialize states from editingItem if present (for "edit existing cart item" flow),
  // otherwise fall back to tier defaults + clean slate. Initializers run on mount.
  const [customization, setCustomization] = useState<HardwareCustomization>(() => {
    if (editingItem?.customization) {
      return editingItem.customization;
    }
    const make = (k: 'ram' | 'vram' | 'disk') => {
      const def = getDefaultOption(slug, k);
      return def ? { value: def.value, label: def.label } : undefined;
    };
    return { ram: make('ram'), vram: make('vram'), disk: make('disk') };
  });

  const [managed, setManaged] = useState(() =>
    !!(editingItem?.services || []).some((s) => s.key === 'managedCare')
  );
  const [backup, setBackup] = useState(() =>
    !!(editingItem?.services || []).some((s) => s.key === 'secureVaultBackup')
  );
  const [quantity, setQuantity] = useState(() => editingItem?.quantity || 1);

  const isEditing = !!editingItem;

  // If the editing target changes while the modal is mounted (or product switches),
  // sync the internal controls. This makes "edit from cart" robust.
  useEffect(() => {
    if (editingItem) {
      setQuantity(editingItem.quantity || 1);
      setManaged(!!(editingItem.services || []).some((s) => s.key === 'managedCare'));
      setBackup(!!(editingItem.services || []).some((s) => s.key === 'secureVaultBackup'));
      if (editingItem.customization) {
        setCustomization(editingItem.customization);
      }
    }
    // Intentionally not resetting to "new item defaults" here; non-edit opens
    // usually cause a fresh mount of the modal via conditional render + product change.
  }, [editingItem?.id, product.id]);

  const staticRows = staticRowsById[product.id] || [];

  // Live authoritative hardware unit price (base + chosen option prices).
  // This is the single logical component call — same fn used by server.
  const hwResolved = resolveHardwarePrice(slug, customization);
  const hardwareUnit = hwResolved.net;
  const hardwareListUnit = hwResolved.list;
  const hardwareExtra = Math.max(0, hardwareUnit - (product.listPrice ?? product.price));

  const managedResolved = resolveServicePrice('managedCare', slug);
  const backupResolved = resolveServicePrice('secureVaultBackup', slug);
  const managedPrice = managedResolved.net * quantity;
  const backupPrice = backupResolved.net * quantity;

  const selectedServices: CartItem['services'] = [];
  if (managed) {
    selectedServices.push({
      name: t('managedCare'),
      price: managedResolved.net,
      listPrice: managedResolved.list,
      key: 'managedCare',
      promotionBadgeKey: managedResolved.badge?.labelKey,
      promotionKind: managedResolved.badge?.kind,
      launchFreeUntil: managedResolved.launchFreeUntil,
    });
  }
  if (backup) {
    selectedServices.push({
      name: t('secureVaultBackup'),
      price: backupResolved.net,
      listPrice: backupResolved.list,
      key: 'secureVaultBackup',
      promotionBadgeKey: backupResolved.badge?.labelKey,
      promotionKind: backupResolved.badge?.kind,
      promoEndsAt: backupResolved.promoEndsAt,
    });
  }

  const totalPrice = hardwareUnit * quantity;
  const recurringPrice = selectedServices.reduce((sum, s) => sum + s.price * quantity, 0);

  const handleAddToCart = () => {
    const item: CartItem = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      product,
      services: selectedServices,
      quantity,
      totalPrice,
      customization,
    };
    onAddToCart(item);
  };

  const applianceLabel = quantity > 1 ? t('appliances') : t('appliance');

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-slate-900 border border-slate-700 w-full max-w-lg rounded-3xl flex flex-col max-h-[92vh] overflow-visible" onClick={e => e.stopPropagation()}>
        {hwResolved.badge && <PromoBadge badge={hwResolved.badge} />}
        <div className="px-7 pt-6 pb-5 border-b border-slate-800 flex justify-between items-start flex-shrink-0">
          <div>
            <div className="font-semibold text-2xl tracking-tight">{product.name}</div>
            <div className="text-xs uppercase tracking-[2px] text-cyan-400 font-bold mt-0.5">{product.tier}</div>
          </div>
          <button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>
        
        <div className="flex-1 overflow-y-auto">
          <div className="p-7">
            <div className="flex justify-between items-baseline mb-6">
              <div className="text-sm text-slate-400">{t('baseAppliance')}</div>
              <PromoPrice
                amount={hardwareUnit}
                listAmount={hardwareListUnit > hardwareUnit ? hardwareListUnit : undefined}
                untilDate={hwResolved.badge?.until}
                mode="oneTime"
                size="lg"
              />
            </div>
            
            <div className="mb-7">
              <div className="uppercase text-xs tracking-widest text-slate-400 mb-3 font-medium">{t('keySpecs')}</div>
              <div className="text-sm">
                {/* Static rows (inference, models, formFactor) */}
                {staticRows.map((row, idx) => (
                  <div key={`static-${idx}`} className="flex justify-between py-[7px] border-b border-slate-800">
                    <span className="text-slate-400">{t(`specs.${row.key}`)}</span>
                    <span className="font-medium">{row.value}</span>
                  </div>
                ))}

                {/* In-place editable spec rows using <select> populated from the central TIER_SPEC_OPTIONS. */}
                {upgradableKeys.map((key) => {
                  const opts = getSpecOptions(slug, key);
                  const chosen = customization[key];
                  const currentValue = chosen?.value ?? (opts.find(o => o.price === 0)?.value ?? opts[0]?.value);
                  const labelKey = key;
                  return (
                    <div key={key} className="flex items-center justify-between py-[7px] border-b border-slate-800 last:border-none">
                      <span className="text-slate-400">{t(`specs.${labelKey}`)}</span>
                      <select
                        value={currentValue}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          const match = opts.find((o) => o.value === val);
                          if (match) {
                            setCustomization((prev) => ({
                              ...prev,
                              [key]: { value: match.value, label: match.label },
                            }));
                          }
                        }}
                        className="bg-slate-950 border border-slate-700 rounded-2xl px-3 py-1 text-sm focus:outline-none focus:border-cyan-500 tabular-nums"
                      >
                        {opts.map((opt) => {
                          const suffix = opt.price > 0
                            ? ` (+${tc('common.price', { amount: opt.price })})`
                            : ` (${t('included')})`;
                          return (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}{suffix}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  );
                })}
              </div>
              {hardwareExtra > 0 && (
                <div className="mt-2 text-xs text-emerald-400 text-right">
                  + {tc('common.price', { amount: hardwareExtra })} hardware upgrades
                </div>
              )}
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
                <label className={`relative flex gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950/60 transition-colors overflow-visible ${managedResolved.badge ? 'mt-4' : ''}`}>
                  {managedResolved.badge && <PromoBadge badge={managedResolved.badge} />}
                  <input type="checkbox" checked={managed} onChange={e => setManaged(e.target.checked)} className={`accent-cyan-400 shrink-0 ${managedResolved.badge ? 'mt-5' : 'mt-1'}`} />
                  <div className={`flex-1 min-w-0 ${managedResolved.badge ? 'pt-5 pr-1' : ''}`}>
                    <div className="flex justify-between items-start gap-3">
                      <span className="font-medium">{t('managedCare')}</span>
                      <PromoPrice
                        amount={managedResolved.net}
                        listAmount={managedResolved.list > managedResolved.net ? managedResolved.list : undefined}
                        untilDate={managedResolved.launchFreeUntil}
                        untilKind="launch_free"
                        suffix={tc('common.perMonth')}
                        size="sm"
                        className="text-emerald-400 shrink-0 max-w-[58%]"
                      />
                    </div>
                    <div className="text-xs text-slate-400">{t('managedCareNote')}</div>
                  </div>
                </label>
                <label className={`relative flex gap-x-3 p-4 border border-slate-700 rounded-2xl cursor-pointer has-[:checked]:border-cyan-500 has-[:checked]:bg-slate-950/60 transition-colors overflow-visible ${backupResolved.badge ? 'mt-4' : ''}`}>
                  {backupResolved.badge && <PromoBadge badge={backupResolved.badge} />}
                  <input type="checkbox" checked={backup} onChange={e => setBackup(e.target.checked)} className={`accent-cyan-400 shrink-0 ${backupResolved.badge ? 'mt-5' : 'mt-1'}`} />
                  <div className={`flex-1 min-w-0 ${backupResolved.badge ? 'pt-5 pr-1' : ''}`}>
                    <div className="flex justify-between items-start gap-3">
                      <span className="font-medium">{t('secureVaultBackup')}</span>
                      <PromoPrice
                        amount={backupResolved.net}
                        listAmount={backupResolved.list > backupResolved.net ? backupResolved.list : undefined}
                        untilDate={backupResolved.promoEndsAt}
                        untilKind="promotion"
                        suffix={tc('common.perMonth')}
                        size="sm"
                        className="text-sky-400 shrink-0 max-w-[58%]"
                      />
                    </div>
                    <div className="text-xs text-slate-400">{t('secureVaultBackupNote')}</div>
                  </div>
                </label>
              </div>
            </div>
          </div>
          
          <div className="bg-slate-950 px-7 py-5 border-t border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-400">{t('totalToday')}</div>
              <div className="text-3xl font-semibold tabular-nums tracking-tighter">{tc('common.price', { amount: totalPrice })}</div>
              {selectedServices.length > 0 && (
                <RecurringServicesSummary
                  lines={selectedServices.map((svc) => ({
                    id: svc.key || svc.name,
                    name: svc.name,
                    price: svc.price,
                    listPrice: svc.listPrice,
                    launchFreeUntil: svc.launchFreeUntil,
                    promoEndsAt: svc.promoEndsAt,
                  }))}
                  className="mt-2 max-w-md"
                />
              )}
            </div>
            <button onClick={handleAddToCart} className="px-8 py-3.5 bg-white hover:bg-slate-100 text-slate-950 font-bold rounded-3xl text-sm">
              {isEditing ? t('updateCart') : t('addToCart')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
