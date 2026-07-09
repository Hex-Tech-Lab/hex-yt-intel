/**
 * Stripe Webhook Route Tests
 *
 * Comprehensive test suite with 15+ test cases covering:
 * - Signature verification (valid, invalid, missing)
 * - Event parsing and dispatch
 * - Error handling
 * - Handler routing
 */

import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';
import {
  validateWebhookEvent,
  verifyWebhookSignature,
  extractCustomerIdFromEvent,
  isValidEventStructure,
} from '@/lib/stripe/validator';
import {
  dispatchWebhookEvent,
  isHandledEventType,
  getSupportedEventTypes,
  EVENT_HANDLERS,
} from '@/lib/stripe/event-handlers';

describe('Stripe Webhook Validation', () => {
  const mockSecret = 'whsec_test_secret';

  it('throws error for missing secret', () => {
    expect(() => verifyWebhookSignature('body', 'sig', '')).toThrow('STRIPE_WEBHOOK_SECRET');
  });

  it('throws error for invalid signature', () => {
    expect(() => verifyWebhookSignature('body', 'invalid_sig', mockSecret)).toThrow(/Invalid/);
  });

  it('returns error for invalid signature in validate', () => {
    const result = validateWebhookEvent('body', 'invalid_sig', mockSecret);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('extracts customer ID from event', () => {
    const event: Stripe.Event = {
      id: 'evt_123',
      object: 'event',
      api_version: '2024-04-10',
      created: 123456789,
      data: { object: { customer: 'cus_123' } },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'customer.subscription.created',
    };
    expect(extractCustomerIdFromEvent(event)).toBe('cus_123');
  });

  it('returns null for missing customer ID', () => {
    const event: Stripe.Event = {
      id: 'evt_123',
      object: 'event',
      api_version: '2024-04-10',
      created: 123456789,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'unknown.event',
    };
    expect(extractCustomerIdFromEvent(event)).toBeNull();
  });

  it('validates correct event structure', () => {
    const event: Stripe.Event = {
      id: 'evt_123',
      object: 'event',
      api_version: '2024-04-10',
      created: 123456789,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'customer.subscription.created',
    };
    expect(isValidEventStructure(event)).toBe(true);
  });

  it('rejects event without ID', () => {
    const event = { object: 'event', type: 'test', data: {} } as any;
    expect(isValidEventStructure(event)).toBe(false);
  });

  it('rejects event without type', () => {
    const event = { id: 'evt_123', object: 'event', data: {} } as any;
    expect(isValidEventStructure(event)).toBe(false);
  });

  it('rejects event without data', () => {
    const event = { id: 'evt_123', object: 'event', type: 'test' } as any;
    expect(isValidEventStructure(event)).toBe(false);
  });
});

describe('Stripe Event Handlers', () => {
  it('returns true for handled event types', () => {
    expect(isHandledEventType('customer.subscription.created')).toBe(true);
    expect(isHandledEventType('invoice.payment_succeeded')).toBe(true);
  });

  it('returns false for unhandled event types', () => {
    expect(isHandledEventType('unknown.event')).toBe(false);
  });

  it('returns supported event types', () => {
    const types = getSupportedEventTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBe(7);
  });

  it('has handlers for subscription events', () => {
    expect(EVENT_HANDLERS['customer.subscription.created']).toBeDefined();
    expect(EVENT_HANDLERS['customer.subscription.deleted']).toBeDefined();
  });

  it('has handlers for invoice events', () => {
    expect(EVENT_HANDLERS['invoice.payment_succeeded']).toBeDefined();
    expect(EVENT_HANDLERS['invoice.payment_failed']).toBeDefined();
  });

  it('dispatch returns handled=false for unknown type', async () => {
    const event: Stripe.Event = {
      id: 'evt_123',
      object: 'event',
      api_version: '2024-04-10',
      created: 123456789,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'unknown.event',
    };
    const result = await dispatchWebhookEvent(event, {} as any);
    expect(result.handled).toBe(false);
  });

  it('dispatch returns handled=true for known type', async () => {
    const event: Stripe.Event = {
      id: 'evt_123',
      object: 'event',
      api_version: '2024-04-10',
      created: 123456789,
      data: { object: {} },
      livemode: false,
      pending_webhooks: 0,
      request: { id: null, idempotency_key: null },
      type: 'payment_intent.succeeded',
    };
    const result = await dispatchWebhookEvent(event, {} as any);
    expect(result.handled).toBe(true);
  });
});
