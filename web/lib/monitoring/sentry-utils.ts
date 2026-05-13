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
  Sentry.captureMessage(message, 'info');
  Sentry.addBreadcrumb({
    message,
    category,
    level: 'info',
    data,
    timestamp: Date.now() / 1000,
  });
}

/**
 * Track API request with automatic timing
 */
export async function trackAPIRequest<T>(
  method: string,
  path: string,
  fn: () => Promise<T>,
  context?: Record<string, unknown>
): Promise<T> {
  const traceId = nanoid();
  const startTime = performance.now();

  Sentry.addBreadcrumb({
    category: 'api',
    message: `${method} ${path}`,
    level: 'info',
    data: {
      method,
      path,
      traceId,
      ...context,
    },
  });

  try {
    const result = await Sentry.startSpan(
      {
        name: `${method} ${path}`,
        op: 'http.client',
        attributes: {
          method,
          path,
          traceId,
        },
      },
      async () => {
        return await fn();
      }
    );

    const duration = performance.now() - startTime;
    Sentry.addBreadcrumb({
      category: 'api',
      message: `${method} ${path} completed`,
      level: 'info',
      data: {
        duration,
        traceId,
      },
    });

    return result;
  } catch (error) {
    const duration = performance.now() - startTime;

    Sentry.captureException(error, {
      tags: {
        api_method: method,
        api_path: path,
        trace_id: traceId,
      },
      contexts: {
        api: {
          method,
          path,
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

/**
 * Clear user context on logout
 */
export function clearUserContext(): void {
  Sentry.setUser(null);
}

/**
 * Tag error with additional context
 */
export function tagError(
  error: Error | unknown,
  tags: Record<string, string>,
  context?: Record<string, unknown>
): void {
  Sentry.captureException(error, {
    tags,
    contexts: context ? { custom: context } : undefined,
  });
}

/**
 * Capture metric value (custom metric)
 * Used for tracking business metrics
 */
export function captureMetric(
  name: string,
  value: number,
  unit = 'none',
  tags?: Record<string, string>
): void {
  Sentry.captureMessage(`Metric: ${name}=${value}${unit}`, 'info');
  Sentry.addBreadcrumb({
    category: 'metric',
    message: `${name}=${value}`,
    level: 'info',
    data: {
      metric_name: name,
      metric_value: value,
      unit,
      ...tags,
    },
  });
}

/**
 * Start a custom transaction for complex operations
 */
export function startTransaction(
  name: string,
  op: string,
  _description?: string
): void {
  // Sentry v8+ uses startSpan instead of startTransaction
  // This is a compatibility shim - actual usage should use startSpan directly
  if (typeof Sentry.startSpan === 'function') {
    Sentry.startSpan({
      name,
      op,
    }, () => {
      // Transaction started - caller should execute code within the callback
    });
  }
}

/**
 * Report error with enhanced context
 */
export function reportError(
  error: Error | unknown,
  context: {
    endpoint?: string;
    method?: string;
    userId?: string;
    tier?: string;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    additionalContext?: Record<string, unknown>;
  } = {}
): void {
  const {
    endpoint,
    method,
    userId,
    tier,
    severity = 'high',
    additionalContext = {},
  } = context;

  Sentry.captureException(error, {
    tags: {
      severity,
      endpoint: endpoint || 'unknown',
      method: method || 'unknown',
    },
    contexts: {
      api: {
        endpoint,
        method,
      },
      user: {
        id: userId,
        tier,
      },
      custom: additionalContext,
    },
    level:
      severity === 'critical' ? 'fatal' : severity === 'high' ? 'error' : 'warning',
  });
}
