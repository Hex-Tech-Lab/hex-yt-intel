import { NextRequest, NextResponse } from 'next/server';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { paddle } from '@/lib/paddle';

/**
 * PADDLE WEBHOOK HANDLER
 * ---------------------
 * Handles subscription lifecycle events.
 */

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('paddle-signature') || '';

  try {
    let event;
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secret && process.env.NODE_ENV === 'development') {
      event = JSON.parse(body);
    } else {
      if (!secret) {
        throw new Error('PADDLE_WEBHOOK_SECRET is required');
      }
      event = paddle.webhooks.unmarshal(body, secret, signature);
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    switch (event.event_type) {
      case 'subscription.created':
      case 'subscription.updated': {
        const userId = event.data.custom_data?.userId;
        if (userId) {
          await persistenceAdapter.updateUserTier({ userId, tier: 'pro' });
        }
        break;
      }
      
      case 'subscription.canceled': {
        const cancelUserId = event.data.custom_data?.userId;
        if (cancelUserId) {
          await persistenceAdapter.updateUserTier({ userId: cancelUserId, tier: 'free' });
        }
        break;
      }
    }

    return NextResponse.json({ processed: true });
  } catch (error) {
    console.error('[Paddle Webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 400 });
  }
}
