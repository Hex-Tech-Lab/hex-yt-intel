/**
 * Stripe Webhook Event Handlers
 * Extracted for modularity and event-specific testing
 *
 * Responsibilities:
 * - Handle individual Stripe event types (payment.succeeded, payment.failed, etc.)
 * - Route events to appropriate domain logic
 * - Maintain event type to handler mapping
 */

import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  handleSubscriptionCreatedUpdated,
  handleSubscriptionCanceled,
  handleInvoicePaid,
  handleInvoiceFailed,
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
} from './webhook-handlers';

export type EventHandler = (
  event: Stripe.Event,
  supabase: SupabaseClient
) => Promise<void> | void;

/**
 * Stripe event handler registry
 * Maps event types to their corresponding handler functions
 */
export const EVENT_HANDLERS: Record<string, EventHandler> = {
  'customer.subscription.created': async (event, supabase) => {
    const subscription = event.data.object as Stripe.Subscription;
    await handleSubscriptionCreatedUpdated(supabase, subscription, 'success');
  },

  'customer.subscription.updated': async (event, supabase) => {
    const subscription = event.data.object as Stripe.Subscription;
    await handleSubscriptionCreatedUpdated(supabase, subscription, 'success');
  },

  'customer.subscription.deleted': async (event, supabase) => {
    const subscription = event.data.object as Stripe.Subscription;
    await handleSubscriptionCanceled(supabase, subscription);
  },

  'invoice.payment_succeeded': async (event, supabase) => {
    const invoice = event.data.object as Stripe.Invoice;
    await handleInvoicePaid(supabase, invoice);
  },

  'invoice.payment_failed': async (event, supabase) => {
    const invoice = event.data.object as Stripe.Invoice;
    await handleInvoiceFailed(supabase, invoice);
  },

  'payment_intent.succeeded': (event) => {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    handlePaymentIntentSucceeded(paymentIntent);
  },

  'payment_intent.payment_failed': (event) => {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    handlePaymentIntentFailed(paymentIntent);
  },
};

/**
 * Dispatch result distinguishes between handler-not-found vs handler-failed
 * - handled: true + no error = successful processing (safe to skip retry)
 * - handled: false = unrecognized event type (safe to skip)
 * - error present = handler threw, should retry with exponential backoff
 */
export interface DispatchResult {
  handled: boolean;
  error?: string;
  retriable?: boolean;
}

export async function dispatchWebhookEvent(
  event: Stripe.Event,
  supabase: SupabaseClient
): Promise<DispatchResult> {
  const handler = EVENT_HANDLERS[event.type];

  if (!handler) {
    return {
      handled: false,
      retriable: false,
      error: `No handler registered for event type: ${event.type}`,
    };
  }

  try {
    await Promise.resolve(handler(event, supabase));
    return { handled: true, retriable: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Handler execution failed';
    console.error(`[Stripe] Handler execution failed for ${event.type}:`, error);
    return {
      handled: false,
      retriable: true,
      error: message,
    };
  }
}

/**
 * Check if an event type is handled
 */
export function isHandledEventType(eventType: string): boolean {
  return eventType in EVENT_HANDLERS;
}

/**
 * Get list of all supported event types
 */
export function getSupportedEventTypes(): string[] {
  return Object.keys(EVENT_HANDLERS);
}
