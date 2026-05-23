export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { stripe, verifyWebhookSignature } from '@/lib/stripe';
import { getSupabaseClient } from '@/lib/supabase';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb, trackDatabaseQuery } from '@/lib/monitoring/sentry-utils';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

if (!webhookSecret) {
  console.warn('[/api/stripe/webhook] STRIPE_WEBHOOK_SECRET not configured');
}

/**
 * Stripe Webhook Handler
 * Handles payment success, failure, and subscription events
 *
 * Events:
 * - customer.subscription.created: User upgraded to Pro
 * - customer.subscription.updated: Subscription modified
 * - customer.subscription.deleted: Subscription canceled
 * - payment_intent.succeeded: Payment successful
 * - payment_intent.payment_failed: Payment failed
 * - invoice.payment_succeeded: Invoice charge succeeded
 * - invoice.payment_failed: Invoice payment failed
 */
export async function POST(request: NextRequest) {
  const startTime = performance.now();

  try {
    // 1. Read raw body for signature verification
    const body = await request.text();

    // 2. Verify webhook signature
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

    // 3. Initialize Supabase
    const supabase = getSupabaseClient();

    // 4. Handle events
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        addBreadcrumb(`Handling ${event.type}`, {
          subscriptionId: subscription.id,
          customerId: subscription.customer,
        });
        await handleSubscriptionEvent(supabase as any, subscription, 'success');
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        addBreadcrumb('Handling customer.subscription.deleted', {
          subscriptionId: subscription.id,
        });
        await handleSubscriptionCanceled(supabase as any, subscription);
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        addBreadcrumb('Handling invoice.payment_succeeded', {
          invoiceId: invoice.id,
          amount: invoice.amount_paid,
        });
        await handleInvoicePaid(supabase as any, invoice);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        addBreadcrumb('Handling invoice.payment_failed', {
          invoiceId: invoice.id,
          amount: invoice.amount_due,
        });
        await handleInvoiceFailed(supabase as any, invoice);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        addBreadcrumb('Payment succeeded', { paymentIntentId: paymentIntent.id });
        console.log('[/api/stripe/webhook] Payment succeeded:', paymentIntent.id);
        break;
      }

      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        addBreadcrumb('Payment failed', { paymentIntentId: paymentIntent.id }, 'billing');
        console.log('[/api/stripe/webhook] Payment failed:', paymentIntent.id);
        break;
      }

      default:
        addBreadcrumb(`Unhandled event type: ${event.type}`, { eventId: event.id });
        console.log(`[/api/stripe/webhook] Unhandled event type: ${event.type}`);
    }

    // 5. Store event for audit trail
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
      // Non-fatal: webhook already processed
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

    // HIGH-6 Fix: Return 500 for unhandled errors to trigger Stripe retry mechanism
    // Do NOT return 200 here, as it swallows the error and permanently drops the event
    return NextResponse.json(
      { error: 'Webhook handler failed' }, 
      { status: 500 }
    );
  }
}

/**
 * Handle subscription created/updated
 */
async function handleSubscriptionEvent(
  supabase: ReturnType<typeof getSupabaseClient>,
  subscription: Stripe.Subscription,
  status: 'success' | 'failed'
): Promise<void> {
  try {
    // Get customer email to find user
    const customerId = subscription.customer as string;
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer === 'string' || customer.deleted) {
      console.error('[handleSubscriptionEvent] Could not retrieve customer:', customerId);
      return;
    }

    const userEmail = customer.email;
    if (!userEmail) {
      console.error('[handleSubscriptionEvent] Customer has no email:', customerId);
      return;
    }

    // Find user by email
    const { data: users, error: queryError } = await supabase
      .from('users')
      .select('id')
      .eq('email', userEmail)
      .maybeSingle();

    if (queryError || !users || typeof users === 'object' && !('id' in users)) {
      console.error('[handleSubscriptionEvent] User not found for email:', userEmail, queryError);
      return;
    }

    const userId = (users as any).id;

    // Update user tier and subscription
    const updateData: Record<string, any> = {
      tier: status === 'success' ? 'pro' : 'free',
      stripe_subscription_id: subscription.id,
      stripe_customer_id: customerId as string,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await (supabase as any)
      .from('users')
      .update(updateData)
      .eq('id', userId);

    if (updateError) {
      console.error('[handleSubscriptionEvent] Failed to update user:', updateError);
      return;
    }

    console.log(`[handleSubscriptionEvent] User ${userId} upgraded to Pro`);

    // Log subscription event
    const logData: Record<string, any> = {
      user_id: userId,
      action: 'subscription_created',
      metadata: {
        subscription_id: subscription.id,
        status,
        amount: subscription.items.data[0]?.price?.unit_amount || 0,
      },
      created_at: new Date().toISOString(),
    };
    await (supabase as any).from('usage_logs').insert(logData);
  } catch (error) {
    console.error('[handleSubscriptionEvent] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleSubscriptionEvent',
        severity: 'high',
      },
    });
  }
}

/**
 * Handle subscription canceled
 */
async function handleSubscriptionCanceled(
  supabase: ReturnType<typeof getSupabaseClient>,
  subscription: Stripe.Subscription
): Promise<void> {
  try {
    const customerId = subscription.customer as string;
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      console.error('[handleSubscriptionCanceled] Could not retrieve customer:', customerId);
      return;
    }

    // Find user by email
    const { data: users, error: queryError } = await supabase
      .from('users')
      .select('id')
      .eq('email', customer.email)
      .maybeSingle();

    if (queryError || !users || typeof users === 'object' && !('id' in users)) {
      console.error('[handleSubscriptionCanceled] User not found:', queryError);
      return;
    }

    const userId = (users as any).id;

    // Downgrade user to free tier
    const downgradeData: Record<string, any> = {
      tier: 'free',
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    };
    const { error: updateError } = await (supabase as any)
      .from('users')
      .update(downgradeData)
      .eq('id', userId);

    if (updateError) {
      console.error('[handleSubscriptionCanceled] Failed to downgrade user:', updateError);
      return;
    }

    console.log(`[handleSubscriptionCanceled] User ${userId} downgraded to Free`);

    // Log cancellation
    const cancelData: Record<string, any> = {
      user_id: userId,
      action: 'subscription_canceled',
      metadata: {
        subscription_id: subscription.id,
        canceled_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };
    await (supabase as any).from('usage_logs').insert(cancelData);
  } catch (error) {
    console.error('[handleSubscriptionCanceled] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleSubscriptionCanceled',
        severity: 'high',
      },
    });
  }
}

/**
 * Handle invoice paid
 */
async function handleInvoicePaid(
  supabase: ReturnType<typeof getSupabaseClient>,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const customerId = invoice.customer as string;
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      console.error('[handleInvoicePaid] Could not retrieve customer:', customerId);
      return;
    }

    // Find user
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('email', customer.email)
      .maybeSingle();

    if (users && typeof users === 'object' && 'id' in users) {
      const userId = (users as any).id;
      // Log payment
      const paymentData: Record<string, any> = {
        user_id: userId,
        action: 'invoice_paid',
        metadata: {
          invoice_id: invoice.id,
          amount: invoice.amount_paid,
          currency: invoice.currency,
        },
        created_at: new Date().toISOString(),
      };
      await (supabase as any).from('usage_logs').insert(paymentData);

      console.log(`[handleInvoicePaid] Invoice ${invoice.id} paid for user ${userId}`);
    }
  } catch (error) {
    console.error('[handleInvoicePaid] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleInvoicePaid',
        severity: 'medium',
      },
    });
  }
}

/**
 * Handle invoice payment failed
 */
async function handleInvoiceFailed(
  supabase: ReturnType<typeof getSupabaseClient>,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
    const customerId = invoice.customer as string;
    const customer = await stripe.customers.retrieve(customerId);

    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      console.error('[handleInvoiceFailed] Could not retrieve customer:', customerId);
      return;
    }

    // Find user
    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('email', customer.email)
      .maybeSingle();

    if (users && typeof users === 'object' && 'id' in users) {
      const userId = (users as any).id;
      // Log failure
      const failureData: Record<string, any> = {
        user_id: userId,
        action: 'invoice_failed',
        metadata: {
          invoice_id: invoice.id,
          amount: invoice.amount_due,
          currency: invoice.currency,
        },
        created_at: new Date().toISOString(),
      };
      await (supabase as any).from('usage_logs').insert(failureData);

      console.log(`[handleInvoiceFailed] Invoice ${invoice.id} failed for user ${userId}`);
    }
  } catch (error) {
    console.error('[handleInvoiceFailed] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleInvoiceFailed',
        severity: 'medium',
      },
    });
  }
}

/**
 * Extract user ID from Stripe event
 */
async function getUserIdFromEvent(event: Stripe.Event): Promise<string | null> {
  try {
    const customerId = (event.data.object as any).customer;
    if (!customerId) return null;

    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      return null;
    }

    const supabase = getSupabaseClient();

    const { data: users } = await supabase
      .from('users')
      .select('id')
      .eq('email', customer.email)
      .maybeSingle();

    return (users && typeof users === 'object' && 'id' in users ? (users as any).id : null) || null;
  } catch (error) {
    console.error('[getUserIdFromEvent] Error:', error);
    return null;
  }
}
