import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getSupabaseClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-04-10',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

/**
 * Stripe webhook handler for subscription events.
 * Validates signature and processes checkout.session.completed to upgrade user tier.
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature') || '';

  // Verify webhook signature
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[/api/billing/webhook] Signature verification failed:', message);
    Sentry.captureException(err, {
      tags: {
        component: 'stripe_webhook',
        error_type: 'signature_verification_failed',
      },
    });
    return NextResponse.json(
      { error: 'Webhook signature verification failed' },
      { status: 401 }
    );
  }

  // Process checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;

    try {
      // Extract user ID from session metadata
      const userId = session.metadata?.userId;

      if (!userId) {
        console.error('[/api/billing/webhook] No userId in session metadata:', session.id);
        Sentry.captureMessage('Webhook received with missing userId metadata', 'error');
        return NextResponse.json(
          { error: 'No userId in session metadata' },
          { status: 400 }
        );
      }

      const supabase = getSupabaseClient();

      // Update user tier to 'pro'
      const { error: updateError } = await supabase
        .from('users')
        .update({
          tier: 'pro',
          stripe_customer_id: session.customer,
        })
        .eq('id', userId);

      if (updateError) {
        console.error('[/api/billing/webhook] Failed to update user tier:', updateError);
        Sentry.captureException(updateError, {
          tags: {
            component: 'stripe_webhook',
            event_type: 'checkout.session.completed',
          },
          contexts: {
            webhook: {
              userId,
              sessionId: session.id,
              customerId: session.customer,
            },
          },
        });
        return NextResponse.json(
          { error: 'Failed to update user tier' },
          { status: 500 }
        );
      }

      // Log successful upgrade
      try {
        await supabase.from('usage_logs').insert({
          user_id: userId,
          action: 'invoice_paid',
          metadata: {
            stripeSessionId: session.id,
            stripeCustomerId: session.customer,
            tier: 'pro',
            amount: session.amount_total ? session.amount_total / 100 : 9.0, // Convert from cents
            currency: session.currency?.toUpperCase() || 'USD',
            timestamp: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
        });
      } catch (logErr) {
        console.warn('[/api/billing/webhook] Failed to log invoice payment:', logErr);
        // Non-fatal: don't fail the webhook if logging fails
      }

      Sentry.captureMessage(`User ${userId} successfully upgraded to Pro`, 'info');
      console.log(`[/api/billing/webhook] User ${userId} upgraded to Pro tier`);

      return NextResponse.json({ received: true }, { status: 200 });
    } catch (err) {
      console.error('[/api/billing/webhook] Unhandled error processing checkout.session.completed:', err);
      Sentry.captureException(err, {
        tags: {
          component: 'stripe_webhook',
          event_type: 'checkout.session.completed',
          severity: 'high',
        },
      });
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  }

  // Other event types (acknowledge and return 200)
  return NextResponse.json({ received: true }, { status: 200 });
}
