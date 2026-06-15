import { randomBytes } from 'crypto';
import {
  calculateHardwarePrice,
  formatHardwareCustomization,
  getHardwarePrice,
  type HardwareCustomization,
  type HardwareSlug,
  type ServiceKey,
} from './pricing';
import { resolveHardwarePrice, resolveServicePrice } from './promotions';
import { BRAND_NAME } from './brand';

export interface HardwareInstance {
  slug: string;
  name: string;
  config: string;
  unitNet: number;
  extraCost: number;
  productLineId: string;
  serialNumber: string;
  includedServices: string[];
}

export interface ServiceInstance {
  key: ServiceKey;
  name: string;
  /** Effective monthly amount due now (0 during launch-free Managed Care). */
  price: number;
  /** Catalog / post-promo list price used for Stripe billing after complimentary period. */
  listPrice: number;
  productLineId: string;
  hostSerialNumber: string;
  hostProductLineId: string;
  hostSlug: HardwareSlug;
  hostName: string;
  launchFreeUntil?: string;
  promotionIds?: string[];
  /** Inclusive end date (YYYY-MM-DD) for time-boxed tier promotions. */
  promoEndsAt?: string;
}

export interface OrderLineInstances {
  hardwareInstances: HardwareInstance[];
  serviceInstances: ServiceInstance[];
}

/**
 * Stable catalog identifier: product display name + pricing version.
 * Used on Stripe line items / invoices to reconcile which product SKU was sold.
 */
export function buildProductLineId(productName: string, pricingVersion: string): string {
  const safeName = productName.trim().replace(/\s+/g, '-');
  return `${safeName}@${pricingVersion}`;
}

/**
 * Unique per physical appliance instance. Used later for update / support management.
 */
export function generateProductSerial(slug: string): string {
  const slugPart = slug.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase() || 'UNIT';
  const unique = randomBytes(5).toString('hex').toUpperCase();
  return `NC-${slugPart}-${unique}`;
}

/**
 * Resolves one hardware instance per physical unit and one service instance per
 * service × appliance (tier-priced, linked to host serial).
 */
export function resolveOrderLineInstances(items: any[] = [], pricingVersion: string): OrderLineInstances {
  const hardwareInstances: HardwareInstance[] = [];
  const serviceInstances: ServiceInstance[] = [];

  for (const item of items) {
    const qty = item.quantity || 1;
    const slug = item.product?.slug as HardwareSlug | undefined;
    if (!slug) continue;

    const hwResolved = resolveHardwarePrice(
      slug,
      item.customization as HardwareCustomization | undefined,
    );
    const unitNet = hwResolved.net;
    const base = getHardwarePrice(slug);
    const extraCost = Math.max(0, unitNet - base);
    const config = formatHardwareCustomization(item.customization as HardwareCustomization | undefined) || 'Standard';
    const name = item.product?.name || slug;
    const productLineId = buildProductLineId(name, pricingVersion);
    const includedServices = (item.services || []).map((s: any) => s.name).filter(Boolean);

    for (let i = 0; i < qty; i++) {
      const serialNumber = generateProductSerial(slug);
      const hw: HardwareInstance = {
        slug,
        name,
        config,
        unitNet,
        extraCost,
        productLineId,
        serialNumber,
        includedServices,
      };
      hardwareInstances.push(hw);

      for (const s of item.services || []) {
        const key = (s.key as ServiceKey | undefined) || inferServiceKey(s.name);
        if (!key) continue;
        const displayName = s.name || key;
        const svcResolved = resolveServicePrice(key, slug);
        serviceInstances.push({
          key,
          name: displayName,
          price: svcResolved.net,
          listPrice: svcResolved.list,
          productLineId: buildProductLineId(displayName, pricingVersion),
          hostSerialNumber: serialNumber,
          hostProductLineId: productLineId,
          hostSlug: slug,
          hostName: name,
          ...(svcResolved.launchFreeUntil ? { launchFreeUntil: svcResolved.launchFreeUntil } : {}),
          ...(svcResolved.promotionIds?.length ? { promotionIds: svcResolved.promotionIds } : {}),
          ...(svcResolved.promoEndsAt ? { promoEndsAt: svcResolved.promoEndsAt } : {}),
        });
      }
    }
  }

  return { hardwareInstances, serviceInstances };
}

/** @deprecated Use resolveOrderLineInstances — kept for tests/helpers. */
export function resolveHardwareInstances(items: any[] = [], pricingVersion: string): HardwareInstance[] {
  return resolveOrderLineInstances(items, pricingVersion).hardwareInstances;
}

function inferServiceKey(name?: string): ServiceKey | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase();
  if (n.includes('managed')) return 'managedCare';
  if (n.includes('vault') || n.includes('backup')) return 'secureVaultBackup';
  return undefined;
}

/** Compact services payload for Stripe metadata (stays under 500 chars/value). */
export function compactServicesForMetadata(services: ServiceInstance[]) {
  return services.map((s) => ({
    n: s.name,
    p: s.price,
    lp: s.listPrice,
    k: s.key,
    sn: s.hostSerialNumber,
    hs: s.hostSlug,
    hn: s.hostName,
    ...(s.launchFreeUntil ? { lfu: s.launchFreeUntil } : {}),
    ...(s.promoEndsAt ? { pe: s.promoEndsAt } : {}),
    ...(s.promotionIds?.length ? { pi: s.promotionIds } : {}),
  }));
}

/** Rehydrate service instances from session/subscription metadata. */
export function parseServicesFromMetadata(
  servicesJson: string,
  pricingVersion: string,
): ServiceInstance[] {
  const arr = JSON.parse(servicesJson) as any[];
  return arr.map((raw) => {
    if (raw.sn || raw.host_serial_number) {
      const name = raw.n || raw.name || 'Service';
      const key = (raw.k || raw.key || inferServiceKey(name) || 'managedCare') as ServiceKey;
      const hostSlug = (raw.hs || raw.host_slug || 'studio') as HardwareSlug;
      const hostName = raw.hn || raw.host_name || hostSlug;
      const hostSerial = raw.sn || raw.host_serial_number;
      const list = raw.lp ?? raw.list_price ?? raw.p ?? raw.price ?? 0;
      const net = raw.p ?? raw.price ?? list;
      return {
        key,
        name,
        price: net,
        listPrice: list,
        productLineId: buildProductLineId(name, pricingVersion),
        hostSerialNumber: hostSerial,
        hostProductLineId: buildProductLineId(hostName, pricingVersion),
        hostSlug,
        hostName,
        ...(raw.lfu || raw.launch_free_until
          ? { launchFreeUntil: raw.lfu || raw.launch_free_until }
          : {}),
        ...(raw.pe || raw.promo_ends_at ? { promoEndsAt: raw.pe || raw.promo_ends_at } : {}),
        ...(raw.pi || raw.promotion_ids
          ? { promotionIds: raw.pi || (typeof raw.promotion_ids === 'string' ? raw.promotion_ids.split(',') : raw.promotion_ids) }
          : {}),
      };
    }
    const name = raw.name || 'Service';
    const key = (raw.key || inferServiceKey(name) || 'managedCare') as ServiceKey;
    const list = raw.list_price ?? raw.price ?? 0;
    return {
      key,
      name,
      price: raw.price ?? list,
      listPrice: list,
      productLineId: buildProductLineId(name, pricingVersion),
      hostSerialNumber: raw.host_serial_number || 'UNKNOWN',
      hostProductLineId: raw.host_product_line_id || '',
      hostSlug: (raw.host_slug || 'studio') as HardwareSlug,
      hostName: raw.host_name || 'Appliance',
      ...(raw.launch_free_until ? { launchFreeUntil: raw.launch_free_until } : {}),
    };
  });
}

export function serviceSubscriptionProductInfo(svc: ServiceInstance): {
  name: string;
  description: string;
  metadata: Record<string, string>;
} {
  // Product name is what Stripe shows on subscription invoice line items — include S/N there.
  const serialLabel = `[S/N: ${svc.hostSerialNumber}]`;
  const launchNote = svc.launchFreeUntil
    ? ` Complimentary until ${svc.launchFreeUntil}, then €${svc.listPrice}/mo.`
    : '';
  const promoNote =
    svc.promoEndsAt && svc.price < svc.listPrice
      ? ` Promotional €${svc.price}/mo until ${svc.promoEndsAt}, then €${svc.listPrice}/mo.`
      : '';
  return {
    name: `${svc.name} — ${svc.hostName} ${serialLabel}`,
    description: `Monthly ${svc.name} for appliance ${serialLabel} (${svc.hostProductLineId}).${launchNote}${promoNote}`,
    metadata: {
      product_line_id: svc.productLineId,
      serial_number: svc.hostSerialNumber,
      service_key: svc.key,
      host_serial_number: svc.hostSerialNumber,
      host_product_line_id: svc.hostProductLineId,
      host_product_slug: svc.hostSlug,
      line_type: 'recurring_service',
      ...(svc.promoEndsAt && svc.price < svc.listPrice
        ? {
            promo_ends_at: svc.promoEndsAt,
            promo_price: String(svc.price),
            list_price: String(svc.listPrice),
          }
        : {}),
      ...(svc.promotionIds?.length ? { promotion_ids: svc.promotionIds.join(',') } : {}),
    },
  };
}

export function serviceSubscriptionMetadata(
  svc: ServiceInstance,
  extra?: Record<string, string>,
): Record<string, string> {
  const info = serviceSubscriptionProductInfo(svc);
  return {
    service: svc.name,
    ...info.metadata,
    ...(svc.launchFreeUntil ? { launch_free_until: svc.launchFreeUntil } : {}),
    ...(svc.promoEndsAt && svc.price < svc.listPrice
      ? {
          promo_ends_at: svc.promoEndsAt,
          promo_price: String(svc.price),
          list_price: String(svc.listPrice),
        }
      : {}),
    ...(svc.promotionIds?.length ? { promotion_ids: svc.promotionIds.join(',') } : {}),
    ...extra,
  };
}

/** Per-unit metadata for Stripe line items / invoice items (not session-level metadata). */
export function hardwareLineItemMetadata(inst: HardwareInstance): Record<string, string> {
  return {
    product_line_id: inst.productLineId,
    serial_number: inst.serialNumber,
    product_slug: inst.slug,
    product_name: inst.name,
    ...(inst.config !== 'Standard' ? { product_config: inst.config } : {}),
  };
}

export function leaseUpfrontNetPerUnit(inst: HardwareInstance, upfrontPercent: number): number {
  return inst.unitNet * (upfrontPercent / 100);
}

export function buildLeaseUpfrontCheckoutLineItems(
  instances: HardwareInstance[],
  grossUnit: (net: number) => number,
  upfrontPercent: number,
  options?: { vatNote?: string },
) {
  return instances.map((inst) => {
    const upfrontNet = leaseUpfrontNetPerUnit(inst, upfrontPercent);
    return {
      price_data: {
        currency: 'eur',
        product_data: {
          name: `${BRAND_NAME} ${inst.name} — Lease Upfront (${upfrontPercent}%)`,
          description: formatHardwareLineDescription(inst, { vatNote: options?.vatNote }),
          metadata: hardwareLineItemMetadata(inst),
        },
        unit_amount: Math.round(grossUnit(upfrontNet) * 100),
      },
      quantity: 1,
    };
  });
}

export function formatLeaseUpfrontLineDescription(
  inst: HardwareInstance,
  upfrontPercent: number,
  options?: { vatNote?: string },
): string {
  const cfg = inst.config !== 'Standard' ? ` • ${inst.config}` : '';
  const svc =
    inst.includedServices.length > 0 ? ` (includes: ${inst.includedServices.join(', ')})` : '';
  const vat = options?.vatNote || '';
  return `${BRAND_NAME} ${inst.name} — Lease upfront (${upfrontPercent}%)${cfg}${svc} [S/N: ${inst.serialNumber}]${vat}`;
}

export function formatHardwareLineDescription(
  inst: HardwareInstance,
  options?: { vatNote?: string; brandName?: string },
): string {
  const brand = options?.brandName || BRAND_NAME;
  const cfg = inst.config !== 'Standard' ? ` • ${inst.config}` : '';
  const svc =
    inst.includedServices.length > 0 ? ` (includes: ${inst.includedServices.join(', ')})` : '';
  const serial = ` [S/N: ${inst.serialNumber}]`;
  const vat = options?.vatNote || '';
  return `${brand} ${inst.name}${cfg}${svc}${serial}${vat}`;
}

export function buildHardwareCheckoutLineItems(
  instances: HardwareInstance[],
  grossUnit: (net: number) => number,
  options?: { vatNote?: string },
): Array<{
  price_data: {
    currency: string;
    product_data: {
      name: string;
      description: string;
      metadata: Record<string, string>;
    };
    unit_amount: number;
  };
  quantity: number;
}> {
  return instances.map((inst) => ({
    price_data: {
      currency: 'eur',
      product_data: {
        name: `${BRAND_NAME} ${inst.name}`,
        description: formatHardwareLineDescription(inst, { vatNote: options?.vatNote }),
        metadata: hardwareLineItemMetadata(inst),
      },
      unit_amount: Math.round(grossUnit(inst.unitNet) * 100),
    },
    quantity: 1,
  }));
}