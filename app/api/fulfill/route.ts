import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { DEBUG_PAYMENTS } from '@/lib/pricing';
import { createFullServiceSubscriptions } from '@/lib/create-service-subscriptions';

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id');
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-05-27.dahlia' as any,
  });

  try {
    // Retrieve the completed checkout session with expansion so we have PM info if needed.
    // We expand both payment_intent (classic full+card/sepa) and setup_intent (the hybrid
    // "Pay by Invoice for hardware + card/SEPA for recurring services" flow) so that
    // createFullServiceSubscriptions can extract the PM for the service subs in either case.
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.payment_method', 'setup_intent.payment_method'],
    });

    const metadata = session.metadata || {};
    const financing = metadata.financing || 'full';

    let servicesArray: Array<{ name: string; price: number }> = [];
    try {
      if (metadata.services) {
        servicesArray = JSON.parse(metadata.services);
      }
    } catch {}

    if (DEBUG_PAYMENTS) {
      console.log('[PAYMENT DEBUG] /api/fulfill GET', {
        sessionId,
        financing,
        servicesLen: servicesArray.length,
        hasCustomer: !!session.customer,
      });
    }

    if (session.customer && financing !== 'lease' && servicesArray.length > 0) {
      console.log(`[PAYMENT DEBUG] fulfill: triggering service sub creation for ${sessionId} (full + services)`);
      await createFullServiceSubscriptions(stripe, session, servicesArray);
      return NextResponse.json({ success: true, message: 'Service subscriptions ensured (or already existed)' });
    }

    return NextResponse.json({ success: true, message: 'No service subs needed for this order' });
  } catch (err: any) {
    console.error('Error in /api/fulfill', err);
    return NextResponse.json({ error: err.message || 'fulfill failed' }, { status: 500 });
  }
}
