/**
 * Centralized Network & Infrastructure Error Handling
 *
 * Provides consistent error categorization, retry eligibility assessment,
 * and structured logging across all API routes.
 */

import * as Sentry from '@sentry/nextjs';

export type ErrorCategory =
  | 'request_validation'
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'network_timeout'
  | 'database_fetch'
  | 'database_write'
  | 'external_service'
  | 'business_logic'
  | 'unknown';

export interface CategorizedError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  statusCode: number;
}

/**
 * Categorize any error by phase and error details.
 * Determines retry eligibility and appropriate HTTP status code.
 *
 * @param error - The error to categorize
 * @param phase - The processing phase where error occurred
 * @returns Categorized error with retry flag and status code
 */
export function categorizeError(error: unknown, phase: string): CategorizedError {
  const message = error instanceof Error ? error.message : String(error);

  // Request validation phase
  if (phase === 'request_validation' || phase === 'json_parse' || phase === 'schema_validation') {
    return {
      category: 'request_validation',
      code: 'INVALID_REQUEST',
      message,
      retryable: false,
      statusCode: 400,
    };
  }

  // Authentication phase
  if (phase === 'authentication' || phase === 'auth') {
    return {
      category: 'authentication',
      code: 'UNAUTHORIZED',
      message,
      retryable: false,
      statusCode: 401,
    };
  }

  // Authorization phase
  if (phase === 'authorization' || phase === 'permission_check') {
    return {
      category: 'authorization',
      code: 'FORBIDDEN',
      message,
      retryable: false,
      statusCode: 403,
    };
  }

  // Rate limiting phase
  if (phase === 'rate_limit' || phase === 'quota_check') {
    return {
      category: 'rate_limit',
      code: 'RATE_LIMITED',
      message,
      retryable: true,
      statusCode: 429,
    };
  }

  // Database fetch operations
  if (phase === 'database_fetch' || phase === 'db_read' || phase === 'cache_lookup') {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET') || message.includes('ETIMEDOUT');
    return {
      category: 'database_fetch',
      code: 'DB_FETCH_ERROR',
      message,
      retryable: isTimeout,
      statusCode: isTimeout ? 503 : 500,
    };
  }

  // Database write operations
  if (phase === 'database_write' || phase === 'db_insert' || phase === 'db_update') {
    const isTransient = message.includes('timeout') || message.includes('connection') || message.includes('ECONNRESET');
    return {
      category: 'database_write',
      code: 'DB_WRITE_ERROR',
      message,
      retryable: isTransient,
      statusCode: isTransient ? 503 : 500,
    };
  }

  // External service calls
  if (phase === 'external_service' || phase === 'embedding_generation' || phase === 'vector_search' || phase === 'llm_call') {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET') || message.includes('AbortError');
    const isRateLimit = message.includes('rate limit') || message.includes('quota') || message.includes('429');

    if (isRateLimit) {
      return {
        category: 'external_service',
        code: 'SERVICE_RATE_LIMIT',
        message,
        retryable: true,
        statusCode: 503,
      };
    }

    if (isTimeout) {
      return {
        category: 'external_service',
        code: 'SERVICE_TIMEOUT',
        message,
        retryable: true,
        statusCode: 503,
      };
    }

    return {
      category: 'external_service',
      code: 'SERVICE_ERROR',
      message,
      retryable: false,
      statusCode: 502,
    };
  }

  // Business logic phase
  if (phase === 'business_logic' || phase === 'validation' || phase === 'constraint_check') {
    return {
      category: 'business_logic',
      code: 'BUSINESS_LOGIC_ERROR',
      message,
      retryable: false,
      statusCode: 400,
    };
  }

  // Network timeout (generic)
  if (phase === 'network_timeout') {
    return {
      category: 'network_timeout',
      code: 'TIMEOUT',
      message,
      retryable: true,
      statusCode: 504,
    };
  }

  // Default: unknown error
  return {
    category: 'unknown',
    code: 'INTERNAL_ERROR',
    message,
    retryable: true,
    statusCode: 500,
  };
}

/**
 * Capture error to Sentry with structured context
 *
 * @param error - The error to capture
 * @param operation - The operation name (e.g., 'search-query', 'analysis-create')
 * @param categorized - The categorized error from categorizeError()
 * @param context - Additional context (userId, videoId, duration, etc.)
 */
export function captureErrorToSentry(
  error: unknown,
  operation: string,
  categorized: CategorizedError,
  context: Record<string, unknown> = {}
): void {
  Sentry.captureException(error, {
    tags: {
      operation,
      category: categorized.category,
      code: categorized.code,
      retryable: String(categorized.retryable),
      statusCode: String(categorized.statusCode),
    },
    contexts: {
      error: {
        category: categorized.category,
        message: categorized.message,
        retryable: categorized.retryable,
      },
      api: context,
    },
  });
}

/**
 * Log error to console with structured format
 *
 * @param prefix - Log prefix (e.g., '[search]', '[analyses]')
 * @param operation - The operation name
 * @param categorized - The categorized error
 * @param context - Additional context to log
 */
export function logError(
  prefix: string,
  operation: string,
  categorized: CategorizedError,
  context: Record<string, unknown> = {}
): void {
  const level = categorized.statusCode >= 500 ? 'error' : categorized.statusCode >= 400 ? 'warn' : 'info';
  const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;

  logFn(`${prefix} ${operation}`, {
    category: categorized.category,
    code: categorized.code,
    message: categorized.message,
    retryable: categorized.retryable,
    statusCode: categorized.statusCode,
    ...context,
  });
}

/**
 * Create a standardized error response
 *
 * @param categorized - The categorized error
 * @returns Response object for NextResponse.json()
 */
export function createErrorResponse(
  categorized: CategorizedError
): { error: string; code: string; retryable?: boolean } {
  return {
    error: categorized.message,
    code: categorized.code,
    ...(categorized.retryable ? { retryable: true } : {}),
  };
}
