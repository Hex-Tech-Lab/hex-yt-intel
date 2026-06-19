import { stripe } from '@/lib/stripe';
import { getSupabaseServiceClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';
import { addBreadcrumb } from '@/lib/monitoring/sentry-utils';

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
  try {
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
    await supabase.from('usage_logs').insert(logData);
  } catch (error) {
    console.error('[handleSubscriptionCreatedUpdated] Error:', error);
    Sentry.captureException(error, {
      tags: {
        handler: 'handleSubscriptionCreatedUpdated',
        severity: 'high',
      },
    });
  }
}

/**
 * Handle subscription canceled
 */
export async function handleSubscriptionCanceled(
  supabase: SupabaseClient,
  subscription: Stripe.Subscription
): Promise<void> {
  try {
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

    const cancelData: Record<string, any> = {
      user_id: userId,
      action: 'subscription_canceled',
      metadata: {
        subscription_id: subscription.id,
        canceled_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    };
    await supabase.from('usage_logs').insert(cancelData);
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
export async function handleInvoicePaid(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
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
      await supabase.from('usage_logs').insert(paymentData);

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
export async function handleInvoiceFailed(
  supabase: SupabaseClient,
  invoice: Stripe.Invoice
): Promise<void> {
  try {
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
      await supabase.from('usage_logs').insert(failureData);

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
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionCreatedUpdated(supabase, subscription, 'success');
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      await handleSubscriptionCanceled(supabase, subscription);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaid(supabase, invoice);
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoiceFailed(supabase, invoice);
      break;
    }

    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      handlePaymentIntentSucceeded(paymentIntent);
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      handlePaymentIntentFailed(paymentIntent);
      break;
    }
  }
}
