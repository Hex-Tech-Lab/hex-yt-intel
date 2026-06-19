export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/stripe';
import { getSupabaseServiceClient } from '@/lib/supabase';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb, trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';
import { dispatchEvent, getUserIdFromEvent } from '@/lib/stripe/webhook-handlers';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

if (!webhookSecret) {
  console.warn('[/api/stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
}

export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    const body = await request.text();

    let event: Stripe.Event;
    try {
      event = verifyWebhookSignature(body, request.headers.get('stripe-signature') || '', webhookSecret);
      addBreadcrumb('Stripe webhook signature verified', { eventType: event.type, eventId: event.id });
    } catch (error) {
      console.error('[/api/stripe/webhook] Signature verification failed:', error);
      addBreadcrumb('Stripe webhook signature verification failed', {
        error: String(error),
      }, 'security');
      Sentry.captureException(error, {
        tags: { webhook: 'stripe', severity: 'critical' },
      });
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServiceClient();

    addBreadcrumb(`Handling ${event.type}`, { eventId: event.id });
    await dispatchEvent(event, supabase as any);

    const userId = await getUserIdFromEvent(event);
    const eventData: Record<string, any> = {
      id: event.id,
      user_id: userId,
      event_type: event.type,
      payload: event.data as any,
      status: 'success',
      created_at: new Date().toISOString(),
    };

    await trackDatabaseQuery(
      'insert',
      'stripe_events',
      () =>
        (supabase as any).from('stripe_events').insert(eventData).then(() => null),
      { eventId: event.id, userId }
    ).catch((error) => {
      console.warn('[/api/stripe/webhook] Failed to store event:', error);
    });

    const duration = Math.round(performance.now() - startTime);
    addBreadcrumb('Stripe webhook processed successfully', {
      eventType: event.type,
      duration,
      userId,
    });

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    const duration = Math.round(performance.now() - startTime);
    console.error('[/api/stripe/webhook] Error:', error);

    Sentry.captureException(error, {
      contexts: {
        webhook: {
          endpoint: '/api/stripe/webhook',
          event_type: 'stripe_webhook',
          duration,
        },
      },
      tags: {
        endpoint: 'stripe_webhook',
        severity: 'critical',
      },
    });

    addBreadcrumb('Unhandled error in Stripe webhook', {
      error: error instanceof Error ? error.message : String(error),
      duration,
    });

    return NextResponse.json(
      { error: 'Webhook handler failed' }, 
      { status: 500 }
    );
  }
}
