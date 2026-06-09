export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getBillingProvider } from '@/lib/billing-factory';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { CheckoutSchema } from '@/lib/types/contracts';
import { guardTraffic, getUserTier } from '@/lib/services/traffic';
import * as Sentry from '@sentry/nextjs';

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
    
    // 4. Create checkout using active provider
    const { url, id } = await provider.createCheckout({
      userId,
      userEmail,
      successUrl: validation.data.successUrl,
      cancelUrl: validation.data.cancelUrl,
      priceId: provider.type === 'paddle' ? process.env.PADDLE_PRO_PRICE_ID! : process.env.STRIPE_PRO_PRICE_ID!,
    });

    if (!url && !id) return NextResponse.json({ error: 'Failed to create checkout' }, { status: 500 });

    // 5. Log activity
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'checkout_initiated',
      metadata: { provider: provider.type },
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
