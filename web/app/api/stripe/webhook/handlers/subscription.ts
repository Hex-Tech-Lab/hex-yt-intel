import { stripe } from '@/lib/stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import * as Sentry from '@sentry/nextjs';

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
