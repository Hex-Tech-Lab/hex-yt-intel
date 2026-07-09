/**
 * Stripe Webhook Signature Verification & Event Parsing
 * Extracted from web/app/api/stripe/webhook/route.ts for modularity and testability
 *
 * Responsibilities:
 * - Signature verification using Stripe webhook secret
 * - Event construction and validation
 * - Error handling for invalid signatures
 */

import Stripe from 'stripe';
import { stripe } from '@/lib/stripe';

export interface WebhookValidationResult {
  valid: boolean;
  event?: Stripe.Event;
  error?: string;
}

/**
 * Verify webhook signature and construct Stripe event
 * Throws on invalid signature; returns event on success
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string
): Stripe.Event {
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  }

  try {
    return stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    console.error('[Stripe] Webhook signature verification failed:', error);
    throw new Error('Invalid webhook signature');
  }
}

/**
 * Validate webhook event structure
 * Returns validation result with parsed event or error details
 */
export function validateWebhookEvent(
  body: string,
  signature: string,
  secret: string
): WebhookValidationResult {
  try {
    const event = verifyWebhookSignature(body, signature, secret);
    return {
      valid: true,
      event,
    };
  } catch (error) {
    console.error('[Stripe] Webhook validation failed:', error);
    return {
      valid: false,
      error: 'Webhook validation failed',
    };
  }
}

/**
 * Extract customer ID from Stripe event
 * Works for most webhook event types that include a customer reference
 */
export function extractCustomerIdFromEvent(event: Stripe.Event): string | null {
  try {
    const obj = event.data.object as any;
    return obj?.customer || null;
  } catch {
    return null;
  }
}

/**
 * Validate event has required data structure
 */
export function isValidEventStructure(event: Stripe.Event): boolean {
  return !!(
    event.id &&
    event.type &&
    event.data &&
    typeof event.data === 'object'
  );
}
