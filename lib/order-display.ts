import { servicesFromOrderMetadata } from './create-service-subscriptions';

export interface OrderDisplayStrings {
  servicesStr: string;
  hardwareStr: string;
}

/**
 * Build human-readable hardware / services strings from Stripe order metadata.
 * Shared by webhook admin emails (checkout.session.completed, invoice.paid, balance fulfill).
 */
export function buildOrderDisplayFromMetadata(
  metadata: Record<string, string | undefined>,
  pricingVersion?: string,
): OrderDisplayStrings {
  const version = pricingVersion || metadata.pricing_version || metadata.pricingVersion || 'unknown';

  let servicesStr = 'None';
  const servicesArray = servicesFromOrderMetadata(metadata.services, version);
  if (servicesArray.length > 0) {
    servicesStr = servicesArray.map((s) => {
      const host = s.hostSerialNumber ? `, appliance S/N ${s.hostSerialNumber}` : '';
      return `${s.name} (€${s.price}/mo${host})`;
    }).join(', ');
  }

  let hardwareStr = 'Standard';
  try {
    if (metadata.hardware) {
      const hw = typeof metadata.hardware === 'string' ? JSON.parse(metadata.hardware) : metadata.hardware;
      if (Array.isArray(hw) && hw.length > 0) {
        hardwareStr = hw.map((h: { name?: string; config?: string; serialNumber?: string }) => {
          const base = h.name || '';
          const sn = h.serialNumber ? `S/N ${h.serialNumber}` : '';
          const cfg = h.config && h.config !== 'Standard' ? h.config : '';
          if (sn) {
            return cfg ? `${base} (${sn}, ${cfg})` : `${base} (${sn})`;
          }
          return cfg ? `${base} (${cfg})` : base;
        }).join(', ');
      }
    }
  } catch {
    // keep default
  }

  return { servicesStr, hardwareStr };
}