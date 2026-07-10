export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { verifyWebhookSignature } from '@/lib/stripe';
import { getSupabaseServiceClient } from '@/lib/supabase';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb } from '@/lib/monitoring/sentry-utils';
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
      const message = error instanceof Error ? error.message : String(error);
      console.error('[/api/stripe/webhook]', { message, url: request.url });
      addBreadcrumb('Stripe webhook signature verification failed', {
        error: message,
      }, 'security');
      Sentry.captureException(error, {
        contexts: { webhook: { endpoint: '/api/stripe/webhook', phase: 'signature_verification' } },
        tags: { webhook: 'stripe', severity: 'critical' },
      });
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServiceClient();

    addBreadcrumb(`Handling ${event.type}`, { eventId: event.id });

    // Idempotency check: skip if already processed
    let existingEvent: { id: string; status?: string } | null = null;
    try {
      const result = await supabase
        .from('stripe_events')
        .select('id, status')
        .eq('id', event.id)
        .single();
      existingEvent = result.data;
    } catch {
      console.warn('[/api/stripe/webhook] Idempotency check failed, proceeding anyway');
    }
    if (existingEvent) {
      return NextResponse.json({ received: true, idempotent: true }, { status: 200 });
    }

    // Pre-insert tentative event record BEFORE dispatch for idempotency
    const userId = await getUserIdFromEvent(event);
    const tentativeEventData: Record<string, any> = {
      id: event.id,
      user_id: userId,
      event_type: event.type,
      payload: event.data as any,
      status: 'pending', // Tentative status
      created_at: new Date().toISOString(),
    };

    const { error: insertError } = await (supabase as any).from('stripe_events').insert(tentativeEventData);
    if (insertError) {
      console.error('[/api/stripe/webhook] Failed to insert tentative stripe event:', insertError);
      Sentry.captureException(insertError, {
        tags: { webhook: 'stripe', phase: 'tentative_insert' },
      });
      // Don't throw; return 200 to Stripe anyway (event was received)
      addBreadcrumb('Could not record tentative event, but proceeding', { eventId: event.id }, 'warning');
    }

    // Dispatch event; catch and log handler failures without propagating
    let dispatchSuccess = true;
    try {
      await dispatchEvent(event, supabase as any);
    } catch (dispatchError) {
      dispatchSuccess = false;
      console.error('[/api/stripe/webhook] Event dispatch failed:', dispatchError);
      Sentry.captureException(dispatchError, {
        contexts: { webhook: { eventType: event.type, phase: 'dispatch' } },
        tags: { webhook: 'stripe', severity: 'high' },
      });
    }

    // Update event record with final status
    if (!insertError) {
      const finalStatus = dispatchSuccess ? 'success' : 'failed';
      const { error: updateError } = await (supabase as any)
        .from('stripe_events')
        .update({ status: finalStatus })
        .eq('id', event.id);

      if (updateError) {
        console.error('[/api/stripe/webhook] Failed to update event status:', updateError);
        Sentry.captureException(updateError, {
          tags: { webhook: 'stripe', phase: 'status_update' },
        });
      }
    }

    const duration = Math.round(performance.now() - startTime);
    const breadcrumbLevel = dispatchSuccess ? 'Stripe webhook processed successfully' : 'Stripe webhook received but dispatch failed';
    addBreadcrumb(breadcrumbLevel, {
      eventType: event.type,
      duration,
      userId,
      dispatchSuccess,
    });

    // Always return 200 to Stripe (event was received and logged)
    return NextResponse.json({ received: true, dispatchSuccess }, { status: 200 });
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
