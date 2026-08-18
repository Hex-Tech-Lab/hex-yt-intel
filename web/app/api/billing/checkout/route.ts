export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getBillingProvider } from '@/lib/billing-factory';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { CheckoutSchema } from '@/lib/types/contracts';
import { guardTraffic, getUserTier } from '@/lib/services/traffic';
import * as Sentry from '@sentry/nextjs';

/**
 * Real (plan, interval) -> price ID allowlist, per provider.
 *
 * Only Pro/monthly has a real, live price ID today (STRIPE_PRICE_ID_PRO /
 * PADDLE_PRO_PRICE_ID -- confirmed $9/mo, matching the current Pro tier
 * candidate price). Light and Max, and Pro/yearly, have NO real provider
 * price ID yet. Previously the route ignored `plan`/`interval` entirely and
 * always charged the Pro monthly price regardless of what the user selected
 * on the pricing table (Cubic P0 finding, 2026-08-18) -- a user who picked
 * "yearly" billing would still be charged the monthly amount/interval with
 * no indication anything was substituted.
 *
 * Real fix: validate the requested (plan, interval) against this explicit
 * allowlist and fail loudly (400) for anything unsupported, instead of
 * silently substituting the Pro/monthly price. Add a new entry here only
 * once a real price ID exists for that combination in the provider
 * dashboard + env vars.
 */
function resolvePriceId(
  providerType: 'paddle' | 'stripe' | 'lemonsqueezy',
  plan: 'light' | 'pro' | 'max',
  interval: 'month' | 'year'
): string | null {
  if (providerType === 'paddle') {
    if (plan === 'pro' && interval === 'month') return process.env.PADDLE_PRO_PRICE_ID || null;
    return null;
  }
  if (providerType === 'stripe') {
    if (plan === 'pro' && interval === 'month') return process.env.STRIPE_PRICE_ID_PRO || null;
    return null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userId = user.id;
    const userEmail = user.email!;

    // 1. Validate request
    const body = await request.json();
    const validation = CheckoutSchema.safeParse(body);
    if (!validation.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    // 2. Traffic guard (quota)
    const userTier = (await getUserTier(userId)) || 'free';
    const { allowed: trafficAllowed, response: trafficResponse } = await guardTraffic(
      'checkout',
      userId,
      userTier,
      userEmail,
      request.headers.get('x-forwarded-for') ?? undefined,
      request.headers.get('user-agent') ?? undefined
    );
    if (!trafficAllowed && trafficResponse) return trafficResponse;

    // 3. Determine active provider via switch
    const provider = getBillingProvider();

    // 3b. Resolve the real price ID for the requested plan+interval. Fail
    // loudly rather than substituting a different plan/interval than what
    // the user actually selected (see resolvePriceId's doc comment).
    const priceId = resolvePriceId(provider.type, validation.data.plan, validation.data.interval);
    if (!priceId) {
      return NextResponse.json(
        {
          error: `Checkout for the "${validation.data.plan}" plan billed ${validation.data.interval}ly is not yet available. Only Pro (monthly) supports checkout today.`,
        },
        { status: 400 }
      );
    }

    // 4. Create checkout using active provider
    const { url, id } = await provider.createCheckout({
      userId,
      userEmail,
      successUrl: validation.data.successUrl,
      cancelUrl: validation.data.cancelUrl,
      priceId,
    });

    if (!url && !id) return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 });

    // 5. Log activity
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'checkout_initiated',
      metadata: { provider: provider.type, plan: validation.data.plan, interval: validation.data.interval },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ 
      sessionUrl: url, 
      checkoutId: id,
      provider: provider.type 
    });
  } catch (error) {
    console.error('[/api/billing/checkout] Error:', error);
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
