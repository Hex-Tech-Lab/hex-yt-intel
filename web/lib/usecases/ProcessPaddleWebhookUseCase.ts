import * as Sentry from '@sentry/nextjs';

import { BillingPort } from '../ports/BillingPort';
import { acquireRedisLock, releaseRedisLock, getRedisValue, setRedisValue } from '../redis';

/** Per-event-id idempotency key prefix (PR #325 round 4). Keys: paddle:evt:<id>:lock / :done */
export const PADDLE_WEBHOOK_EVENT_KEY_PREFIX = 'paddle:evt:';

/**
 * In-flight lock TTL in seconds (`paddle:evt:<id>:lock`, SET NX EX 60). Only
 * needs to cover a single processing attempt; if the holder crashes the lock
 * self-expires and Paddle's retry re-processes.
 */
export const PADDLE_WEBHOOK_LOCK_TTL_SECONDS = 60;

/**
 * Completion-marker TTL in seconds (`paddle:evt:<id>:done`, SET EX 7 days).
 * 7 days covers Paddle's full retry schedule (retries span ~3 days); after
 * expiry, the adapter's `updated_at` staleness guard remains the backstop.
 */
export const PADDLE_WEBHOOK_DONE_TTL_SECONDS = 7 * 24 * 60 * 60;

export class ProcessPaddleWebhookUseCase {
  constructor(private billingAdapter: BillingPort) {}

  async execute(rawBody: string, signatureHeader: string | null, secret: string | undefined): Promise<{ success: boolean; status: number; message: string }> {
    if (!signatureHeader || !secret) {
      return { success: false, status: 401, message: 'Missing signature or secret' };
    }

    if (!this.billingAdapter.verifySignature(rawBody, signatureHeader, secret)) {
      return { success: false, status: 401, message: 'Invalid signature' };
    }

    let lockKey: string | null = null;
    let lockToken: string | null = null;

    try {
      const payload = this.billingAdapter.parseWebhookEvent(rawBody);

      // Idempotency, two separate keys per event id (PR #325 round 4):
      //  - `:done` completion marker: written only AFTER the entitlement
      //    change is committed. A re-delivery that finds it returns 200
      //    WITHOUT re-processing (Paddle treats 2xx as delivered).
      //  - `:lock` in-flight lock: held while processing. A concurrent
      //    duplicate gets 409 (NEVER 200) so Paddle retries later instead
      //    of silently losing the event if the holder crashes.
      // Events without an event_id skip both and rely on the adapter's
      // updated_at guard.
      const eventId = typeof payload?.event_id === 'string' && payload.event_id !== '' ? payload.event_id : null;
      if (eventId) {
        const doneKey = `${PADDLE_WEBHOOK_EVENT_KEY_PREFIX}${eventId}:done`;
        const doneMarker = await getRedisValue(doneKey);
        if (doneMarker) {
          return { success: true, status: 200, message: 'Duplicate event ignored' };
        }
        lockKey = `${PADDLE_WEBHOOK_EVENT_KEY_PREFIX}${eventId}:lock`;
        lockToken = await acquireRedisLock(lockKey, PADDLE_WEBHOOK_LOCK_TTL_SECONDS);
        if (!lockToken) {
          return { success: false, status: 409, message: 'Event is currently being processed, retry later' };
        }
      }

      let result: { success: boolean; error?: string } = { success: true };
      if (payload.event_type.startsWith('subscription.')) {
        result = await this.billingAdapter.processSubscriptionEvent(payload);
      } else if (payload.event_type.startsWith('transaction.')) {
        result = await this.billingAdapter.processTransactionEvent(payload);
      } else {
        result = { success: true };
      }
      if (!result.success) {
        // Any processing error releases the lock and returns 5xx so Paddle
        // retries the delivery instead of treating it as delivered.
        if (lockKey && lockToken) {
          await releaseRedisLock(lockKey, lockToken);
        }
        return { success: false, status: 500, message: result.error || 'Failed to process' };
      }
      // Entitlement change committed: record the completion marker, then
      // release the in-flight lock. Redis failures here never fail the
      // webhook — the adapter's updated_at guard backstops.
      if (eventId && lockKey) {
        await setRedisValue(`${PADDLE_WEBHOOK_EVENT_KEY_PREFIX}${eventId}:done`, '1', PADDLE_WEBHOOK_DONE_TTL_SECONDS);
      }
      if (lockKey && lockToken) {
        await releaseRedisLock(lockKey, lockToken);
      }
      return { success: true, status: 200, message: 'Processed' };
    } catch (processingError: unknown) {
      if (lockKey && lockToken) {
        await releaseRedisLock(lockKey, lockToken);
      }
      Sentry.captureException(processingError, {
        tags: { boundary: 'ProcessPaddleWebhookUseCase' },
      });
      console.error('[ProcessPaddleWebhookUseCase] Error processing webhook event:', processingError);
      return { success: false, status: 500, message: processingError instanceof Error ? processingError.message : String(processingError) };
    }
  }
}
