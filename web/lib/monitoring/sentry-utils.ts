import * as Sentry from '@sentry/nextjs';
import { nanoid } from 'nanoid';

/**
 * Performance monitoring utilities for Sentry integration
 * Tracks API latency, database operations, and external service calls
 */


/**
 * Add a breadcrumb to track operation context
 */
export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  category = 'operation'
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    level: 'info',
    data,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Track database query with timing
 */
export async function trackDatabaseQuery<T>(
  operation: string,
  table: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const startTime = performance.now();

  return Sentry.startSpan(
    {
      name: `db.${operation}`,
      op: 'db',
      attributes: {
        operation,
        table,
      },
    },
    async () => {
      try {
        const result = await fn();
        const duration = performance.now() - startTime;

        Sentry.addBreadcrumb({
          category: 'database',
          message: `${operation} on ${table}`,
          level: 'info',
          data: {
            operation,
            table,
            duration,
            ...context,
          },
        });

        return result;
      } catch (error) {
        const duration = performance.now() - startTime;

        Sentry.captureException(error, {
          tags: {
            db_operation: operation,
            db_table: table,
          },
          contexts: {
            database: {
              operation,
              table,
              duration,
              ...context,
            },
          },
          level: 'error',
        });

        throw error;
      }
    }
  );
}

/**
 * Track external service call (Worker, OpenRouter, Stripe, etc.)
 */
export async function trackExternalCall<T>(
  service: string,
  operation: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const traceId = nanoid();
  const startTime = performance.now();

  Sentry.addBreadcrumb({
    category: 'external_service',
    message: `Calling ${service}: ${operation}`,
    level: 'info',
    data: {
      service,
      operation,
      traceId,
      ...context,
    },
  });

  return Sentry.startSpan(
    {
      name: `${service}.${operation}`,
      op: 'external.http',
      attributes: {
        service,
        operation,
        traceId,
      },
    },
    async () => {
      try {
        const result = await fn();
        const duration = performance.now() - startTime;

        // Log successful call
        if (duration > 2000) {
          Sentry.captureMessage(`Slow ${service} call (${duration}ms)`, 'warning');
        }

        return result;
      } catch (error) {
        const duration = performance.now() - startTime;

        Sentry.captureException(error, {
          tags: {
            service,
            operation,
            trace_id: traceId,
          },
          contexts: {
            external_service: {
              service,
              operation,
              duration,
              traceId,
              ...context,
            },
          },
          level: 'error',
        });

        throw error;
      }
    }
  );
}

/**
 * Set user context for error tracking
 * Use when user authenticates
 */
export function setUserContext(
  userId: string,
  email?: string,
  tier?: 'free' | 'pro' | 'enterprise'
): void {
  Sentry.setUser({
    id: userId,
    email,
    username: email?.split('@')[0],
  });

  Sentry.setTag('user_tier', tier || 'unknown');
  Sentry.setContext('user', {
    id: userId,
    tier: tier || 'unknown',
  });
}

// clearUserContext removed — logout clears session server-side; client Sentry user resets on next setUserContext call

