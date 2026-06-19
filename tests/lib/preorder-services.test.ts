import { describe, it, expect, vi, beforeEach } from 'vitest';
import Stripe from 'stripe';
import {
  resolvePreorderServiceTrialEnd,
  PREORDER_SERVICE_DEFERRAL_SECONDS,
  createPreorderServiceSubscriptions,
} from '@/lib/create-service-subscriptions';
import { launchFreeUntilEpoch } from '@/lib/promotions';
import type { ServiceInstance } from '@/lib/product-instances';
import { PRICING_VERSION } from '@/lib/pricing';

function edgeManagedCare(launchFreeUntil?: string): ServiceInstance {
  return {
    key: 'managedCare',
    name: 'Managed Care',
    price: 0,
    listPrice: 58,
    productLineId: `Managed-Care@${PRICING_VERSION}`,
    hostSerialNumber: 'NC-EDGE-TEST',
    hostProductLineId: `Edge@${PRICING_VERSION}`,
    hostSlug: 'edge',
    hostName: 'Edge',
    launchFreeUntil,
  };
}

describe('resolvePreorderServiceTrialEnd', () => {
  const balancePaidAt = Math.floor(new Date('2026-06-19T12:00:00Z').getTime() / 1000);

  it('defers billing ~32 days after balance payment when no launch promo', () => {
    const vault: ServiceInstance = {
      ...edgeManagedCare(),
      key: 'secureVaultBackup',
      name: 'SecureVault Backup',
      price: 29,
      listPrice: 29,
      launchFreeUntil: undefined,
    };
    expect(resolvePreorderServiceTrialEnd(vault, balancePaidAt)).toBe(
      balancePaidAt + PREORDER_SERVICE_DEFERRAL_SECONDS,
    );
  });

  it('uses later of deferral or launch-free end for Managed Care', () => {
    const trial = resolvePreorderServiceTrialEnd(edgeManagedCare('2027-01-01'), balancePaidAt);
    expect(trial).toBe(launchFreeUntilEpoch('2027-01-01'));
  });
});

describe('createPreorderServiceSubscriptions', () => {
  let stripe: {
    subscriptions: {
      list: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    customers: { update: ReturnType<typeof vi.fn> };
    products: { create: ReturnType<typeof vi.fn> };
    prices: { create: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    stripe = {
      subscriptions: {
        list: vi.fn().mockResolvedValue({ data: [] }),
        create: vi.fn().mockResolvedValue({ id: 'sub_pre', latest_invoice: null }),
        update: vi.fn().mockResolvedValue({}),
      },
      customers: { update: vi.fn().mockResolvedValue({}) },
      products: { create: vi.fn().mockResolvedValue({ id: 'prod_1' }) },
      prices: { create: vi.fn().mockResolvedValue({ id: 'price_1' }) },
    };
  });

  it('creates deferred subs with preorder metadata after balance paid', async () => {
    const balancePaidAt = Math.floor(new Date('2026-06-19T12:00:00Z').getTime() / 1000);
    const servicesJson = JSON.stringify([
      { n: 'Managed Care', p: 0, lp: 58, k: 'managedCare', sn: 'NC-EDGE-TEST', hs: 'edge', hn: 'Edge', lfu: '2027-01-01' },
    ]);

    await createPreorderServiceSubscriptions(stripe as unknown as Stripe, {
      customerId: 'cus_1',
      depositSessionId: 'cs_deposit_1',
      servicesJson,
      pricingVersion: PRICING_VERSION,
      balancePaidAtUnix: balancePaidAt,
      defaultPaymentMethod: 'pm_1',
    });

    expect(stripe.subscriptions.create).toHaveBeenCalledTimes(1);
    const subArg = stripe.subscriptions.create.mock.calls[0][0];
    expect(subArg.trial_end).toBe(launchFreeUntilEpoch('2027-01-01'));
    expect(subArg.metadata.is_preorder_service).toBe('true');
    expect(subArg.metadata.order_session).toBe('cs_deposit_1');
  });

  it('skips when preorder service subs already exist for deposit session', async () => {
    stripe.subscriptions.list.mockResolvedValue({
      data: [{
        id: 'sub_existing',
        metadata: { order_session: 'cs_deposit_1', is_preorder_service: 'true' },
      }],
    });

    await createPreorderServiceSubscriptions(stripe as unknown as Stripe, {
      customerId: 'cus_1',
      depositSessionId: 'cs_deposit_1',
      servicesJson: '[{"n":"X","p":1,"k":"secureVaultBackup","sn":"S1","hs":"edge","hn":"Edge"}]',
      pricingVersion: PRICING_VERSION,
      balancePaidAtUnix: 1_700_000_000,
    });

    expect(stripe.subscriptions.create).not.toHaveBeenCalled();
  });
});