import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

/**
 * PADDLE WEBHOOK HANDLER
 * ---------------------
 * Handles subscription lifecycle events.
 */

export async function POST(request: NextRequest) {
  const body = await request.text();

  try {
    // 1. Verify Webhook (Boilerplate - requires PADDLE_WEBHOOK_SECRET)
    // const event = paddle.webhooks.unmarshal(body, process.env.PADDLE_WEBHOOK_SECRET!, signature);
    const event = JSON.parse(body); // Temporary bypass for dev until secret is set

    const supabase = await getSupabaseClientWithAuth();

    switch (event.event_type) {
      case 'subscription.created':
      case 'subscription.updated':
        const userId = event.data.custom_data?.userId;
        if (userId) {
          await supabase
            .from('users')
            .update({ tier: 'pro', updated_at: new Date().toISOString() })
            .eq('id', userId);
        }
        break;
      
      case 'subscription.canceled':
        const cancelUserId = event.data.custom_data?.userId;
        if (cancelUserId) {
          await supabase
            .from('users')
            .update({ tier: 'free', updated_at: new Date().toISOString() })
            .eq('id', cancelUserId);
        }
        break;
    }

    return NextResponse.json({ processed: true });
  } catch (error) {
    console.error('[Paddle Webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 400 });
  }
}
