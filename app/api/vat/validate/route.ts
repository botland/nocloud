import { NextRequest, NextResponse } from 'next/server';
import { validateVatWithVies } from '@/lib/vies';

/**
 * Server-side VIES VAT validation endpoint.
 * Used by CheckoutModal for live feedback; checkout route re-validates authoritatively.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { vatNumber, country } = body as { vatNumber?: string; country?: string };

    if (!vatNumber?.trim()) {
      return NextResponse.json({ valid: false, reason: 'No VAT number provided' }, { status: 400 });
    }

    const result = await validateVatWithVies(vatNumber, country);

    if (result.unavailable) {
      return NextResponse.json(
        { valid: false, unavailable: true, reason: result.reason },
        { status: 503 },
      );
    }

    return NextResponse.json({
      valid: result.isValid,
      reason: result.reason,
      name: result.name,
      address: result.address,
    });
  } catch (err) {
    console.error('VAT validate route error', err);
    return NextResponse.json(
      { valid: false, unavailable: true, reason: 'VAT validation failed' },
      { status: 500 },
    );
  }
}