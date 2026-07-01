import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { processAllRecurringDunning } from '@/lib/recurring-dunning';
import { checkRateLimit, rateLimitKeyFromRequest } from '@/lib/admin-rate-limit';

function authorizeCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const adminKey = process.env.ADMIN_API_KEY;
  const auth = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  const adminHeader = request.headers.get('x-admin-api-key') || '';

  if (cronSecret && (auth === `Bearer ${cronSecret}` || cronHeader === cronSecret)) {
    return true;
  }
  if (adminKey && (auth === `Bearer ${adminKey}` || adminHeader === adminKey)) {
    return true;
  }
  return false;
}

/**
 * Daily dunning progression for recurring service subscriptions.
 * Commerce-mode agnostic — applies to all charge_automatically service subs.
 */
export async function POST(request: NextRequest) {
  const rateKey = rateLimitKeyFromRequest(request, 'recurring-dunning-cron');
  const rate = checkRateLimit(rateKey, 10, 60_000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia' as any,
  });

  try {
    const result = await processAllRecurringDunning(stripe);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error('Recurring dunning cron error', err);
    return NextResponse.json({ error: err.message || 'Dunning failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}