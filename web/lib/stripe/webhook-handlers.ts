import { stripe } from '@/lib/stripe';
import { getSupabaseServiceClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb } from '@/lib/monitoring/sentry-utils';
import { z } from 'zod';
import { USAGE_LOG_SCHEMA } from '@/lib/usage/usage-log-schema';

/**
 * Centralized helper to validate and insert usage logs with consistent error handling.
 * Returns success/failure status to allow callers to decide on retry/alert strategy.
 * Logs and captures all errors in Sentry while remaining non-blocking.
 */
async function insertUsageLog(
  supabase: SupabaseClient,
  logData: unknown,
  contextLabel: string
): Promise<boolean> {
  try {
    const validatedLog = USAGE_LOG_SCHEMA.parse(logData);
    const { error: insertError } = await supabase.from('usage_logs').insert(validatedLog);
    if (insertError) {
      console.error(`[${contextLabel}]`, { message: 'Failed to insert usage log', error: insertError.message });
      Sentry.captureException(new Error(insertError.message), { contexts: { handler: contextLabel, layer: 'usage_log_insert' } });
      return false;
    }
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`[${contextLabel}]`, { message: 'Schema validation failed', issues: error.issues });
      Sentry.captureException(error, { contexts: { handler: contextLabel, layer: 'usage_log_validation' } });
    } else {
      console.error(`[${contextLabel}]`, { message: 'Failed to insert usage log', error: error instanceof Error ? error.message : String(error) });
      Sentry.captureException(error, { contexts: { handler: contextLabel, layer: 'usage_log_insert' } });
    }
    return false;
  }
}

/**
 * Extract user ID from Stripe event
 */
export async function getUserIdFromEvent(event: Stripe.Event): Promise<string | null> {
  try {
    const customerId = (event.data.object as any).customer;
    if (!customerId) return null;

    const customer = await stripe.customers.retrieve(customerId);
    if (typeof customer === 'string' || customer.deleted || !customer.email) {
      return null;
    }

    const supabase = getSupabaseServiceClient();

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

/**
 * Handle subscription created or updated
 */
export async function handleSubscriptionCreatedUpdated(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription,
  status: 'success' | 'failed'
): Promise<void> {
  const customerId = subscription.customer as string;
  const customer = await stripe.customers.retrieve(customerId);

  if (typeof customer === 'string' || customer.deleted) {
    console.error('[handleSubscriptionCreatedUpdated] Could not retrieve customer:', customerId);
    return;
  }

  const userEmail = customer.email;
  if (!userEmail) {
    console.error('[handleSubscriptionCreatedUpdated] Customer has no email:', customerId);
    return;
  }

  const { data: users, error: queryError } = await supabase
    .from('users')
    .select('id, stripe_customer_id')
    .eq('email', userEmail)
    .maybeSingle();

  if (queryError || !users || (typeof users === 'object' && !('id' in users))) {
    console.error('[handleSubscriptionCreatedUpdated] User not found for email:', userEmail, queryError);
    return;
  }

  const userId = (users as any).id;

  const existingCustomerId = (users as any).stripe_customer_id;
  if (existingCustomerId && existingCustomerId !== customerId) {
    console.error('[handleSubscriptionCreatedUpdated] Customer ID mismatch for user:', userId, {
      event: customerId,
      stored: existingCustomerId,
    });
    Sentry.captureMessage('Stripe customer ID mismatch detected', {
      level: 'error',
      tags: { security: 'customer_ownership' },
    });
    return;
  }

  const updateData: Record<string, any> = {
    tier: status === 'success' ? 'pro' : 'free',
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId as string,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await supabase
    .from('users')
    .update(updateData)
    .eq('id', userId);

  if (updateError) {
    console.error('[handleSubscriptionCreatedUpdated] Failed to update user:', updateError);
    return;
  }

  console.log(`[handleSubscriptionCreatedUpdated] User ${userId} upgraded to Pro`);

  const logData = {
    user_id: userId,
    action: 'subscription_created',
    metadata: {
      subscription_id: subscription.id,
      status,
      amount: subscription.items.data[0]?.price?.unit_amount || 0,
    },
    created_at: new Date().toISOString(),
  };
  await insertUsageLog(supabase, logData, 'handleSubscriptionCreatedUpdated');
}

/**
 * Handle subscription canceled
 */
export async function handleSubscriptionCanceled(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription
): Promise<void> {
  const customerId = subscription.customer as string;
  const customer = await stripe.customers.retrieve(customerId);

  if (typeof customer === 'string' || customer.deleted || !customer.email) {
    console.error('[handleSubscriptionCanceled] Could not retrieve customer:', customerId);
    return;
  }

  const { data: users, error: queryError } = await supabase
    .from('users')
    .select('id, stripe_customer_id')
    .eq('email', customer.email)
    .maybeSingle();

  if (queryError || !users || (typeof users === 'object' && !('id' in users))) {
    console.error('[handleSubscriptionCanceled] User not found:', queryError);
    return;
  }

  const userId = (users as any).id;

  const existingCustomerId = (users as any).stripe_customer_id;
  if (existingCustomerId && existingCustomerId !== customerId) {
    console.error('[handleSubscriptionCanceled] Customer ID mismatch for user:', userId, {
      event: customerId,
      stored: existingCustomerId,
    });
    Sentry.captureMessage('Stripe customer ID mismatch on cancellation', {
      level: 'error',
      tags: { security: 'customer_ownership' },
    });
    return;
  }

  const downgradeData: Record<string, any> = {
    tier: 'free',
    stripe_subscription_id: null,
    updated_at: new Date().toISOString(),
  };
  const { error: updateError } = await supabase
    .from('users')
    .update(downgradeData)
    .eq('id', userId);

  if (updateError) {
    console.error('[handleSubscriptionCanceled] Failed to downgrade user:', updateError);
    return;
  }

  console.log(`[handleSubscriptionCanceled] User ${userId} downgraded to Free`);

  const cancelData = {
    user_id: userId,
    action: 'subscription_canceled',
    metadata: {
      subscription_id: subscription.id,
      canceled_at: new Date().toISOString(),
    },
    created_at: new Date().toISOString(),
  };
  await insertUsageLog(supabase, cancelData, 'handleSubscriptionCanceled');
}

/**
 * Handle invoice paid
 */
export async function handleInvoicePaid(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  const customerId = invoice.customer as string;
  const customer = await stripe.customers.retrieve(customerId);

  if (typeof customer === 'string' || customer.deleted || !customer.email) {
    console.error('[handleInvoicePaid] Could not retrieve customer:', customerId);
    return;
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, stripe_customer_id')
    .eq('email', customer.email)
    .maybeSingle();

  if (users && typeof users === 'object' && 'id' in users) {
    const userId = (users as any).id;

    const existingCustomerId = (users as any).stripe_customer_id;
    if (existingCustomerId && existingCustomerId !== customerId) {
      console.error('[handleInvoicePaid] Customer ID mismatch for user:', userId, {
        event: customerId,
        stored: existingCustomerId,
      });
      Sentry.captureMessage('Stripe customer ID mismatch on invoice payment', {
        level: 'error',
        tags: { security: 'customer_ownership' },
      });
      return;
    }

    const paymentData = {
      user_id: userId,
      action: 'invoice_paid',
      metadata: {
        invoice_id: invoice.id,
        amount: invoice.amount_paid,
        currency: invoice.currency,
      },
      created_at: new Date().toISOString(),
    };
    await insertUsageLog(supabase, paymentData, 'handleInvoicePaid');

    console.log(`[handleInvoicePaid] Invoice ${invoice.id} paid for user ${userId}`);
  }
}

/**
 * Handle invoice payment failed
 */
export async function handleInvoiceFailed(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  addBreadcrumb('Payment failed', { invoiceId: invoice.id }, 'billing');
  const customerId = invoice.customer as string;
  const customer = await stripe.customers.retrieve(customerId);

  if (typeof customer === 'string' || customer.deleted || !customer.email) {
    console.error('[handleInvoiceFailed] Could not retrieve customer:', customerId);
    return;
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, stripe_customer_id')
    .eq('email', customer.email)
    .maybeSingle();

  if (users && typeof users === 'object' && 'id' in users) {
    const userId = (users as any).id;

    const existingCustomerId = (users as any).stripe_customer_id;
    if (existingCustomerId && existingCustomerId !== customerId) {
      console.error('[handleInvoiceFailed] Customer ID mismatch for user:', userId, {
        event: customerId,
        stored: existingCustomerId,
      });
      Sentry.captureMessage('Stripe customer ID mismatch on invoice failure', {
        level: 'error',
        tags: { security: 'customer_ownership' },
      });
      return;
    }

    const failureData = {
      user_id: userId,
      action: 'invoice_failed',
      metadata: {
        invoice_id: invoice.id,
        amount: invoice.amount_due,
        currency: invoice.currency,
      },
      created_at: new Date().toISOString(),
    };
    await insertUsageLog(supabase, failureData, 'handleInvoiceFailed');

    console.log(`[handleInvoiceFailed] Invoice ${invoice.id} failed for user ${userId}`);
  }
}

/**
 * Handle payment intent succeeded
 */
export function handlePaymentIntentSucceeded(paymentIntent: Stripe.PaymentIntent): void {
  addBreadcrumb('Payment succeeded', { paymentIntentId: paymentIntent.id });
  console.log('[/api/stripe/webhook] Payment succeeded:', paymentIntent.id);
}

/**
 * Handle payment intent failed
 */
export function handlePaymentIntentFailed(paymentIntent: Stripe.PaymentIntent): void {
  addBreadcrumb('Payment failed', { paymentIntentId: paymentIntent.id }, 'billing');
  console.log('[/api/stripe/webhook] Payment failed:', paymentIntent.id);
}

/**
 * Main dispatcher to route Stripe webhook events to correct helpers
 */
export async function dispatchEvent(
  event: Stripe.Event,
  supabase: SupabaseClient
): Promise<void> {
  const eventHandlers: Record<string, () => Promise<void> | void> = {
    'customer.subscription.created': () => handleSubscriptionCreatedUpdated(supabase, event.data.object as Stripe.Subscription, 'success'),
    'customer.subscription.updated': () => handleSubscriptionCreatedUpdated(supabase, event.data.object as Stripe.Subscription, 'success'),
    'customer.subscription.deleted': () => handleSubscriptionCanceled(supabase, event.data.object as Stripe.Subscription),
    'invoice.payment_succeeded': () => handleInvoicePaid(supabase, event.data.object as Stripe.Invoice),
    'invoice.payment_failed': () => handleInvoiceFailed(supabase, event.data.object as Stripe.Invoice),
    'payment_intent.succeeded': () => handlePaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent),
    'payment_intent.payment_failed': () => handlePaymentIntentFailed(event.data.object as Stripe.PaymentIntent),
  };

  const handler = eventHandlers[event.type];
  if (handler) await handler();
}
