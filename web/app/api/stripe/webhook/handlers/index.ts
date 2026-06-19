import { stripe } from '@/lib/stripe';
import { getSupabaseServiceClient } from '@/lib/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { handleSubscriptionCreatedUpdated, handleSubscriptionCanceled } from './subscription';
import { handleInvoicePaid, handleInvoiceFailed } from './invoice';
import { handlePaymentIntentSucceeded, handlePaymentIntentFailed } from './payment-intent';

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

export {
  handleSubscriptionCreatedUpdated,
  handleSubscriptionCanceled,
  handleInvoicePaid,
  handleInvoiceFailed,
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
};
