export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import { PaddleBillingAdapter } from '@/lib/adapters/PaddleBillingAdapter';
import { getBillingProvider } from '@/lib/billing-factory';
import { resolvePriceId, type PriceProviderId } from '@/lib/config/pricing';
import { guardTraffic, getUserTier } from '@/lib/services/traffic';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { CheckoutSchema } from '@/lib/types/contracts';

/**
 * Real (plan, interval, provider) -> price ID resolution, now Settings-
 * Registry-backed (2026-08-18, web/lib/config/pricing.ts) instead of a
 * hardcoded allowlist -- adding a new tier/interval/provider price ID is a
 * registry edit (admin settings page), not a code change/redeploy.
 *
 * Only Pro/monthly has a real, live-or-sandbox price ID resolved from an env
 * var today (STRIPE_PRICE_ID_PRO / PADDLE_PRO_PRICE_ID); Light/Pro-yearly/Max
 * resolve real Paddle SANDBOX price IDs seeded by migration
 * 20260818174553_billing_price_ids_registry.sql. Dodo/Creem resolve to null
 * for every combo until those providers get a real BillingProvider
 * implementation + API keys (see that migration's header comment).
 *
 * Same fail-closed contract as before (Cubic P0 finding, 2026-08-18): a null
 * resolution is a 400, never a silent substitution of a different
 * plan/interval than what the user actually requested.
 */
function resolveCheckoutPriceId(
  providerType: 'paddle' | 'stripe' | 'lemonsqueezy',
  plan: 'light' | 'pro' | 'max' | 'founder' | 'founder_tier_a',
  interval: 'month' | 'year' | 'once'
): Promise<string | null> {
  // The registry's PriceProviderId union (paddle/stripe/dodo/creem) doesn't
  // include lemonsqueezy -- it was never part of the real MoR shortlist
  // (Paddle/Dodo/Creem) this registry was built for, so it has no price IDs
  // and always fails closed here.
  if (providerType === 'lemonsqueezy') return Promise.resolve(null);
  return resolvePriceId(plan, interval, providerType as PriceProviderId);
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

    // 3. Determine active provider
    const provider = getBillingProvider();

    let sessionUrl: string | null = null;
    let checkoutId: string | null = null;

    if (provider.type === 'paddle') {
      // Use PaddleBillingAdapter directly to ensure { userId, planTier, email } customData is attached
      const adapter = new PaddleBillingAdapter();
      const planTier = (validation.data.plan === 'founder_tier_a' ? 'founder' : validation.data.plan) as 'founder' | 'pro';
      const result = await adapter.createCheckoutSession(userId, userEmail, planTier);
      sessionUrl = result.checkoutUrl;
    } else {
      // 3b. Resolve price ID for alternative providers (e.g. Stripe)
      const priceId = await resolveCheckoutPriceId(provider.type, validation.data.plan, validation.data.interval);
      if (!priceId) {
        return NextResponse.json(
          {
            error: `Checkout for the "${validation.data.plan}" plan billed ${validation.data.interval}ly is not yet available.`,
          },
          { status: 400 }
        );
      }

      // 4. Create checkout using active provider
      const res = await provider.createCheckout({
        userId,
        userEmail,
        successUrl: validation.data.successUrl,
        cancelUrl: validation.data.cancelUrl,
        priceId,
      });
      sessionUrl = res.url;
      checkoutId = res.id;
    }

    if (!sessionUrl && !checkoutId) {
      return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 });
    }

    // 5. Log activity
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'checkout_initiated',
      metadata: { provider: provider.type, plan: validation.data.plan, interval: validation.data.interval },
      created_at: new Date().toISOString(),
    });

    return NextResponse.json({ 
      sessionUrl, 
      checkoutId,
      provider: provider.type 
    });
  } catch (error) {
    console.error('[/api/billing/checkout] Error:', error);
    Sentry.captureException(error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
