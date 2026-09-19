import { NextRequest, NextResponse } from 'next/server';
import { SupabasePersistenceAdapter } from '@/lib/adapters';
import { paddle } from '@/lib/paddle';
import { resolveUserTierForPriceId, mapPlanStringToUserTier } from '@/lib/config/pricing';
import * as Sentry from '@sentry/nextjs';

import type { UserTier } from '@/lib/types/billing';

/**
 * PADDLE WEBHOOK HANDLER (LEGACY)
 * ---------------------
 * Handles subscription lifecycle events. Retained alongside
 * /api/webhooks/paddle (2026-09-19 tier-vocabulary step 1): liveness could
 * not be disproven from code evidence alone (Paddle dashboard webhook-config
 * inspection is outside this worktree's reach), so per the fail-safe rule
 * BOTH routes are treated as live and BOTH now use the same shared
 * price-ID -> UserTier mapping (web/lib/config/pricing.ts). Deletion
 * recommendation: verify the Paddle dashboard's webhook URL, then remove
 * whichever route is not configured there.
 */

interface PaddleEventShape {
  event_type: string;
  data: {
    custom_data?: { userId?: string; user_id?: string; planTier?: string; plan_tier?: string } | null;
    status?: string | null;
    items?: Array<{ price?: { id?: string; custom_data?: { plan_tier?: string } | null } | null } | undefined> | null;
  };
}

/** Resolve the tier an event grants, via the shared mapping. Fails closed. */
async function resolveEventTier(event: PaddleEventShape): Promise<UserTier | null> {
  if (event.data.status === 'canceled') return 'free';
  const priceId = event.data.items?.[0]?.price?.id;
  const fromPrice = await resolveUserTierForPriceId(priceId);
  if (fromPrice) return fromPrice;
  return mapPlanStringToUserTier(event.data.custom_data?.planTier)
    ?? mapPlanStringToUserTier(event.data.items?.[0]?.price?.custom_data?.plan_tier);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('paddle-signature') || '';

  try {
    let event;
    const secret = process.env.PADDLE_WEBHOOK_SECRET;

    if (!secret && process.env.NODE_ENV === 'development' && !process.env.VERCEL) {
      if (process.env.DEV_ALLOW_UNVERIFIED_WEBHOOKS !== 'true') {
        throw new Error('PADDLE_WEBHOOK_SECRET is missing. Set DEV_ALLOW_UNVERIFIED_WEBHOOKS=true to bypass verification in development.');
      }
      console.warn('[Paddle Webhook] WARNING: Using unverified webhook payload fallback in development mode.');
      event = JSON.parse(body);
    } else {
      if (!secret) {
        throw new Error('PADDLE_WEBHOOK_SECRET is required');
      }
      event = await paddle.webhooks.unmarshal(body, secret, signature);
    }

    const persistenceAdapter = new SupabasePersistenceAdapter();

    switch (event.event_type) {
      case 'subscription.created':
      case 'subscription.updated': {
        const userId = event.data.custom_data?.userId;
        if (userId) {
          const tier = await resolveEventTier(event);
          if (!tier) {
            console.error('[Paddle Webhook] Unrecognised price ID, failing closed (tier unchanged)', { priceId: event.data.items?.[0]?.price?.id ?? null });
            Sentry.captureMessage('Legacy Paddle webhook: unrecognised price ID, tier unchanged', { level: 'error', extra: { priceId: event.data.items?.[0]?.price?.id ?? null } });
            return NextResponse.json({ error: 'Unrecognised price ID, tier not changed' }, { status: 400 });
          }
          await persistenceAdapter.updateUserTier({ userId, tier });
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

      default:
        break;
    }

    return NextResponse.json({ processed: true });
  } catch (error) {
    console.error('[Paddle Webhook] Error:', error);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 400 });
  }
}
