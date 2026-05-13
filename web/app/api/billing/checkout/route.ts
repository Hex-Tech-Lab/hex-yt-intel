import { getServerSession } from 'next-auth';
import { authConfig } from '@/lib/auth/nextauth-config';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession, getOrCreateStripeCustomer } from '@/lib/stripe';
import * as Sentry from '@sentry/nextjs';

interface CheckoutRequest {
  successUrl: string;
  cancelUrl: string;
}

interface CheckoutResponse {
  sessionUrl: string;
}

export async function POST(request: NextRequest) {
  try {
    // 1. Auth check
    const session = await getServerSession(authConfig);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = (session.user as any).id;
    const userEmail = session.user.email;

    if (!userEmail) {
      return NextResponse.json(
        { error: 'User email is required' },
        { status: 400 }
      );
    }

    // 2. Parse request
    const body: CheckoutRequest = await request.json();
    if (!body.successUrl || !body.cancelUrl) {
      return NextResponse.json(
        { error: 'successUrl and cancelUrl are required' },
        { status: 400 }
      );
    }

    // 3. Fetch user data from Supabase
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email, name, tier, stripe_customer_id')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return NextResponse.json(
        { error: 'Failed to fetch user data' },
        { status: 500 }
      );
    }

    // 4. Check if already pro
    if (userData.tier === 'pro') {
      return NextResponse.json(
        { error: 'User already has Pro subscription' },
        { status: 400 }
      );
    }

    // 5. Get or create Stripe customer
    let customerId = userData.stripe_customer_id;
    if (!customerId) {
      customerId = await getOrCreateStripeCustomer(
        userId,
        userEmail,
        userData.name
      );

      // Update user with Stripe customer ID
      const { error: updateError } = await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId);

      if (updateError) {
        console.error('[/api/billing/checkout] Failed to update stripe_customer_id:', updateError);
        return NextResponse.json(
          { error: 'Failed to create checkout session' },
          { status: 500 }
        );
      }
    }

    // 6. Create checkout session
    const checkoutUrl = await createCheckoutSession(
      customerId,
      body.successUrl,
      body.cancelUrl
    );

    if (!checkoutUrl) {
      return NextResponse.json(
        { error: 'Failed to create checkout session' },
        { status: 500 }
      );
    }

    // 7. Log checkout session creation
    await supabase.from('usage_logs').insert({
      user_id: userId,
      action: 'checkout_initiated',
      metadata: {
        tier: 'pro',
        amount: 900,
        currency: 'usd',
      },
      created_at: new Date().toISOString(),
    });

    const response: CheckoutResponse = {
      sessionUrl: checkoutUrl,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    console.error('[/api/billing/checkout] Error:', error);
    Sentry.captureException(error, {
      contexts: {
        api: {
          endpoint: '/api/billing/checkout',
          method: 'POST',
        },
      },
      tags: {
        endpoint: 'billing_checkout',
        severity: 'high',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
