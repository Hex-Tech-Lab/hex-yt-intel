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
  code?: 'MISSING_SECRET' | 'INVALID_SIGNATURE' | 'MALFORMED_EVENT' | 'UNKNOWN_ERROR';
}

const verifyWebhookSignature = (
  body: string,
  signature: string,
  secret: string
): Stripe.Event => {
  if (!secret) {
    const err = new Error('STRIPE_WEBHOOK_SECRET not configured');
    (err as any).code = 'MISSING_SECRET';
    throw err;
  }

  try {
    return stripe.webhooks.constructEvent(body, signature, secret);
  } catch (error) {
    const err = new Error(error instanceof Error ? error.message : 'Invalid webhook signature');
    // Stripe throws "No matching key version" for signature mismatch
    (err as any).code = (error instanceof Error && error.message.includes('key version'))
      ? 'INVALID_SIGNATURE'
      : 'MALFORMED_EVENT';
    console.error('[Stripe] Webhook signature verification failed:', error);
    throw err;
  }
};

/**
 * Validate webhook event structure and signature
 * Returns validation result with parsed event or granular error classification
 */
export const validateWebhookEvent = (
  body: string,
  signature: string,
  secret: string
): WebhookValidationResult => {
  try {
    const event = verifyWebhookSignature(body, signature, secret);
    return {
      valid: true,
      event,
    };
  } catch (error) {
    const code = (error as any)?.code || 'UNKNOWN_ERROR';
    const message = error instanceof Error ? error.message : 'Webhook validation failed';
    console.error(`[Stripe] Webhook validation failed (${code}):`, message);
    return {
      valid: false,
      error: message,
      code,
    };
  }
};

/**
 * Extract customer ID from Stripe event
 * Works for most webhook event types that include a customer reference
 */
export const extractCustomerIdFromEvent = (event: Stripe.Event): string | null => {
  try {
    const obj = event.data.object as any;
    return obj?.customer || null;
  } catch {
    return null;
  }
};

/**
 * Validate event has required data structure
 */
export const isValidEventStructure = (event: Stripe.Event): boolean =>
  Boolean(event.id && event.type && event.data && typeof event.data === 'object');
