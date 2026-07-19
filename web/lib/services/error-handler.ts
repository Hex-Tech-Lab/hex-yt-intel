/**
 * Centralized Network & Infrastructure Error Handling
 *
 * Provides consistent error categorization, retry eligibility assessment,
 * and structured logging across all API routes.
 *
 * IMPORTANT: Use ERROR_PHASES typed constants instead of free-form strings.
 * This ensures type safety and prevents runtime phase drift from typos.
 */

import * as Sentry from '@sentry/nextjs';
import { ERROR_PHASES, type ErrorPhase } from '@/lib/error-codes';

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
  phase: ErrorPhase;
}

/**
 * Categorize any error by phase and error details.
 * Determines retry eligibility and appropriate HTTP status code.
 *
 * @param error - The error to categorize
 * @param phase - The processing phase where error occurred (use ERROR_PHASES constants)
 * @returns Categorized error with retry flag and status code
 *
 * @example
 * // GOOD: Type-safe, compile-checked
 * const err = categorizeError(error, ERROR_PHASES.DATABASE_FETCH);
 *
 * // BAD: Runtime risk, typos not caught
 * const err = categorizeError(error, 'database_fetch');
 */
export function categorizeError(error: unknown, phase: ErrorPhase): CategorizedError {
  const message = error instanceof Error ? error.message : String(error);

  // Request validation phase (including JSON parse and schema validation)
  if (
    phase === ERROR_PHASES.REQUEST_VALIDATION ||
    phase === ERROR_PHASES.JSON_PARSE ||
    phase === ERROR_PHASES.SCHEMA_VALIDATION
  ) {
    return {
      category: 'request_validation',
      code: 'INVALID_REQUEST',
      message,
      retryable: false,
      statusCode: 400,
      phase,
    };
  }

  // Authentication phase
  if (phase === ERROR_PHASES.AUTHENTICATION) {
    return {
      category: 'authentication',
      code: 'UNAUTHORIZED',
      message,
      retryable: false,
      statusCode: 401,
      phase,
    };
  }

  // Authorization phase
  if (phase === ERROR_PHASES.AUTHORIZATION) {
    return {
      category: 'authorization',
      code: 'FORBIDDEN',
      message,
      retryable: false,
      statusCode: 403,
      phase,
    };
  }

  // Rate limiting phase (including quota checks)
  if (phase === ERROR_PHASES.RATE_LIMIT || phase === ERROR_PHASES.QUOTA_CHECK) {
    return {
      category: 'rate_limit',
      code: 'RATE_LIMITED',
      message,
      retryable: true,
      statusCode: 429,
      phase,
    };
  }

  // Database fetch operations (including cache lookups and idempotency checks)
  if (
    phase === ERROR_PHASES.DATABASE_FETCH ||
    phase === ERROR_PHASES.CACHE_LOOKUP ||
    phase === ERROR_PHASES.IDEMPOTENCY_CHECK
  ) {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET') || message.includes('ETIMEDOUT');
    return {
      category: 'database_fetch',
      code: 'DB_FETCH_ERROR',
      message,
      retryable: isTimeout,
      statusCode: isTimeout ? 503 : 500,
      phase,
    };
  }

  // Database write operations
  if (phase === ERROR_PHASES.DATABASE_WRITE) {
    const isTransient = message.includes('timeout') || message.includes('connection') || message.includes('ECONNRESET');
    return {
      category: 'database_write',
      code: 'DB_WRITE_ERROR',
      message,
      retryable: isTransient,
      statusCode: isTransient ? 503 : 500,
      phase,
    };
  }

  // Signature verification (chat-specific, retryable on timeout)
  if (phase === ERROR_PHASES.SIGNATURE_VERIFICATION) {
    const isTimeout = message.includes('timeout') || message.includes('AbortError');
    return {
      category: 'authentication',
      code: 'INVALID_SIGNATURE',
      message,
      retryable: isTimeout,
      statusCode: isTimeout ? 503 : 401,
      phase,
    };
  }

  // Ownership check (authorization-like, not retryable)
  if (phase === ERROR_PHASES.OWNERSHIP_CHECK) {
    return {
      category: 'authorization',
      code: 'UNAUTHORIZED',
      message,
      retryable: false,
      statusCode: 404,
      phase,
    };
  }

  // External service calls (embeddings, vector search, LLM calls)
  if (
    phase === ERROR_PHASES.EXTERNAL_SERVICE ||
    phase === ERROR_PHASES.EMBEDDING_GENERATION ||
    phase === ERROR_PHASES.VECTOR_SEARCH
  ) {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET') || message.includes('AbortError');
    const isRateLimit = message.includes('rate limit') || message.includes('quota') || message.includes('429');

    if (isRateLimit) {
      return {
        category: 'external_service',
        code: 'SERVICE_RATE_LIMIT',
        message,
        retryable: true,
        statusCode: 503,
        phase,
      };
    }

    if (isTimeout) {
      return {
        category: 'external_service',
        code: 'SERVICE_TIMEOUT',
        message,
        retryable: true,
        statusCode: 503,
        phase,
      };
    }

    return {
      category: 'external_service',
      code: 'SERVICE_ERROR',
      message,
      retryable: false,
      statusCode: 502,
      phase,
    };
  }

  // Result enrichment (can fail per-result without failing whole batch)
  if (phase === ERROR_PHASES.RESULT_ENRICHMENT) {
    const isTimeout = message.includes('timeout') || message.includes('ECONNRESET');
    return {
      category: 'database_fetch',
      code: 'ENRICHMENT_FAILED',
      message,
      retryable: isTimeout,
      statusCode: isTimeout ? 503 : 500,
      phase,
    };
  }

  // Business logic phase (validation, constraints)
  if (
    phase === ERROR_PHASES.BUSINESS_LOGIC ||
    phase === ERROR_PHASES.VALIDATION ||
    phase === ERROR_PHASES.CONSTRAINT_CHECK
  ) {
    return {
      category: 'business_logic',
      code: 'BUSINESS_LOGIC_ERROR',
      message,
      retryable: false,
      statusCode: 400,
      phase,
    };
  }

  // Network timeout (generic)
  if (phase === ERROR_PHASES.NETWORK_TIMEOUT) {
    return {
      category: 'network_timeout',
      code: 'TIMEOUT',
      message,
      retryable: true,
      statusCode: 504,
      phase,
    };
  }

  // Default: unknown error (type safety ensures we only reach this for UNKNOWN phase)
  return {
    category: 'unknown',
    code: 'INTERNAL_ERROR',
    message,
    retryable: true,
    statusCode: 500,
    phase,
  };
}

/**
 * Capture error to Sentry with structured context
 *
 * @param error - The error to capture
 * @param operation - The operation name (e.g., 'search-query', 'analysis-create')
 * @param categorized - The categorized error from categorizeError()
 * @param phase - The error phase (used for Sentry tag)
 * @param context - Additional context (userId, videoId, duration, etc.)
 */
export function captureErrorToSentry(
  error: unknown,
  operation: string,
  categorized: CategorizedError,
  phase?: ErrorPhase,
  context: Record<string, unknown> = {}
): void {
  Sentry.captureException(error, {
    tags: {
      operation,
      phase: phase || categorized.phase || 'unknown',
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
    phase: categorized.phase,
    ...context,
  });
}

/**
 * Client-safe error message mappings (redacts internal details).
 * Maps error categories to user-friendly messages suitable for API responses.
 */
const CLIENT_ERROR_MESSAGES: Record<ErrorCategory, string> = {
  'request_validation': 'Invalid request',
  'authentication': 'Authentication failed',
  'authorization': 'Access denied',
  'rate_limit': 'Rate limit exceeded',
  'network_timeout': 'Request timed out',
  'database_fetch': 'Service temporarily unavailable',
  'database_write': 'Service temporarily unavailable',
  'external_service': 'External service error',
  'business_logic': 'Request could not be processed',
  'unknown': 'An error occurred',
};

/**
 * Create a standardized error response with safe client-facing messages.
 * Sanitizes internal error details to prevent information leakage.
 *
 * @param categorized - The categorized error
 * @returns Response object for NextResponse.json()
 */
export function createErrorResponse(
  categorized: CategorizedError
): { error: string; code: string; retryable?: boolean } {
  return {
    error: CLIENT_ERROR_MESSAGES[categorized.category],
    code: categorized.code,
    ...(categorized.retryable ? { retryable: true } : {}),
  };
}
