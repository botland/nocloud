import { describe, it, expect, afterEach } from 'vitest';
import { getCommerceMode, isPreorderMode, isLiveMode } from '@/lib/commerce-mode';

describe('lib/commerce-mode', () => {
  const original = process.env.NEXT_PUBLIC_COMMERCE_MODE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NEXT_PUBLIC_COMMERCE_MODE;
    } else {
      process.env.NEXT_PUBLIC_COMMERCE_MODE = original;
    }
  });

  it('defaults to preorder when env unset', () => {
    delete process.env.NEXT_PUBLIC_COMMERCE_MODE;
    expect(getCommerceMode()).toBe('preorder');
    expect(isPreorderMode()).toBe(true);
    expect(isLiveMode()).toBe(false);
  });

  it('returns live when NEXT_PUBLIC_COMMERCE_MODE=live', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'live';
    expect(getCommerceMode()).toBe('live');
    expect(isLiveMode()).toBe(true);
    expect(isPreorderMode()).toBe(false);
  });

  it('returns live when NEXT_PUBLIC_COMMERCE_MODE is LIVE (case-insensitive)', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'LIVE';
    expect(getCommerceMode()).toBe('live');
    expect(isLiveMode()).toBe(true);
    expect(isPreorderMode()).toBe(false);
  });

  it('treats any non-live value as preorder', () => {
    process.env.NEXT_PUBLIC_COMMERCE_MODE = 'something-else';
    expect(getCommerceMode()).toBe('preorder');
  });
});