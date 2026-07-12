/**
 * Error Code Registry
 * Centralized dictionary of all failure modes for consistent logging and Sentry tagging.
 * Format: ERR_CATEGORY_SPECIFIC_FAILURE
 */

export const ERROR_CODES = {
  // Authentication & Authorization
  AUTH_UNAUTHORIZED: 'ERR_AUTH_UNAUTHORIZED',
  AUTH_SESSION_INVALID: 'ERR_AUTH_SESSION_INVALID',
  AUTH_MISSING_USER_ID: 'ERR_AUTH_MISSING_USER_ID',

  // Rate Limiting & Quotas
  RATE_LIMIT_EXCEEDED: 'ERR_RATE_LIMIT_EXCEEDED',
  MONTHLY_QUOTA_EXHAUSTED: 'ERR_MONTHLY_QUOTA_EXHAUSTED',
  QUOTA_EXCEEDED: 'ERR_QUOTA_EXCEEDED',
  QUOTA_ENFORCEMENT_FAILED: 'ERR_QUOTA_ENFORCEMENT_FAILED',
  QUOTA_FETCH_FAILED: 'ERR_QUOTA_FETCH_FAILED',
  TIER_NULL: 'ERR_TIER_NULL',
  TIER_FETCH_FAILED: 'ERR_TIER_FETCH_FAILED',

  // Input Validation
  INVALID_JSON: 'ERR_INVALID_JSON',
  INVALID_REQUEST_SCHEMA: 'ERR_INVALID_REQUEST_SCHEMA',
  INVALID_VIDEO_URL: 'ERR_INVALID_VIDEO_URL',
  INVALID_VIDEO_ID: 'ERR_INVALID_VIDEO_ID',

  // External Services
  CLOUDFLARE_WORKER_ERROR: 'ERR_CLOUDFLARE_WORKER_ERROR',
  CLOUDFLARE_TRANSCRIPT_NOT_FOUND: 'ERR_CLOUDFLARE_TRANSCRIPT_NOT_FOUND',
  CLOUDFLARE_METADATA_INVALID: 'ERR_CLOUDFLARE_METADATA_INVALID',
  CLOUDFLARE_SSRF_BLOCKED: 'ERR_CLOUDFLARE_SSRF_BLOCKED',
  OPENROUTER_TIMEOUT: 'ERR_OPENROUTER_TIMEOUT',
  OPENROUTER_RATE_LIMIT: 'ERR_OPENROUTER_RATE_LIMIT',
  OPENROUTER_UNAVAILABLE: 'ERR_OPENROUTER_UNAVAILABLE',
  PROVIDER_QUOTA_EXHAUSTED: 'ERR_PROVIDER_QUOTA_EXHAUSTED',
  DECODO_TRANSCRIPTION_FAILED: 'ERR_DECODO_TRANSCRIPTION_FAILED',
  QSTASH_QUEUE_FAILED: 'ERR_QSTASH_QUEUE_FAILED',
  QSTASH_PUBLISH_FAILED: 'ERR_QSTASH_PUBLISH_FAILED',

  // Database Operations
  DATABASE_CACHE_LOOKUP_FAILED: 'ERR_DATABASE_CACHE_LOOKUP_FAILED',
  DATABASE_USER_FETCH_FAILED: 'ERR_DATABASE_USER_FETCH_FAILED',
  DATABASE_ANALYSIS_INSERT_FAILED: 'ERR_DATABASE_ANALYSIS_INSERT_FAILED',
  DATABASE_ANALYSIS_UPDATE_FAILED: 'ERR_DATABASE_ANALYSIS_UPDATE_FAILED',
  DATABASE_USAGE_LOG_FAILED: 'ERR_DATABASE_USAGE_LOG_FAILED',

  // Environment & Configuration
  ENV_MISSING_VARIABLE: 'ERR_ENV_MISSING_VARIABLE',
  ENV_INVALID_VALUE: 'ERR_ENV_INVALID_VALUE',
  ENV_INCOMPLETE_CONFIG: 'ERR_ENV_INCOMPLETE_CONFIG',

  // Analysis Processing
  ANALYSIS_GENERATION_FAILED: 'ERR_ANALYSIS_GENERATION_FAILED',
  ANALYSIS_STREAMING_FAILED: 'ERR_ANALYSIS_STREAMING_FAILED',
  ANALYSIS_MARKDOWN_EMPTY: 'ERR_ANALYSIS_MARKDOWN_EMPTY',
  ANALYSIS_TIMEOUT: 'ERR_ANALYSIS_TIMEOUT',
  ANALYSIS_PERSONA_INVALID: 'ERR_ANALYSIS_PERSONA_INVALID',

  // Server Errors
  INTERNAL_SERVER_ERROR: 'ERR_INTERNAL_SERVER_ERROR',
  UNHANDLED_EXCEPTION: 'ERR_UNHANDLED_EXCEPTION',
  REQUEST_HANDLER_ERROR: 'ERR_REQUEST_HANDLER_ERROR',

  // Search Operations
  SEARCH_QUERY_INVALID: 'ERR_SEARCH_QUERY_INVALID',
  SEARCH_VECTOR_FAILED: 'ERR_SEARCH_VECTOR_FAILED',
  SEARCH_DATABASE_FAILED: 'ERR_SEARCH_DATABASE_FAILED',

  // General Errors
  NOT_FOUND: 'ERR_NOT_FOUND',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Error context for structured logging
 */
export interface ErrorContext {
  code: ErrorCode;
  message: string;
  userId?: string;
  videoId?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
  stack?: string;
}

/**
 * Create a standardized error context
 */
export function createErrorContext(
  code: ErrorCode,
  message: string,
  context?: Partial<Omit<ErrorContext, 'code' | 'message'>>
): ErrorContext {
  return {
    code,
    message,
    ...context,
  };
}

/**
 * ============================================================================
 * ERROR PHASES - Processing Lifecycle Stages
 * ============================================================================
 *
 * Single source of truth for all API error phases across the codebase.
 * Using a const object with `as const` ensures TypeScript type safety
 * and prevents runtime drift from typos or unregistered phase strings.
 *
 * Phases represent the lifecycle stage where an error occurred, enabling
 * consistent retry logic and Sentry categorization.
 */

export const ERROR_PHASES = {
  // Request handling
  REQUEST_VALIDATION: 'request_validation',
  JSON_PARSE: 'json_parse',
  SCHEMA_VALIDATION: 'schema_validation',

  // Authentication & Authorization
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',

  // Rate limiting & Quota
  RATE_LIMIT: 'rate_limit',
  QUOTA_CHECK: 'quota_check',

  // Embedding & Vector operations
  EMBEDDING_GENERATION: 'embedding_generation',
  VECTOR_SEARCH: 'vector_search',

  // Database operations
  DATABASE_FETCH: 'database_fetch',
  DATABASE_WRITE: 'database_write',
  IDEMPOTENCY_CHECK: 'idempotency_check',
  CACHE_LOOKUP: 'cache_lookup',

  // Chat-specific operations
  SIGNATURE_VERIFICATION: 'signature_verification',
  OWNERSHIP_CHECK: 'ownership_check',

  // Business logic
  BUSINESS_LOGIC: 'business_logic',
  VALIDATION: 'validation',
  CONSTRAINT_CHECK: 'constraint_check',

  // Network operations
  EXTERNAL_SERVICE: 'external_service',
  NETWORK_TIMEOUT: 'network_timeout',

  // Result enrichment
  RESULT_ENRICHMENT: 'result_enrichment',

  // Fallback
  UNKNOWN: 'unknown',
} as const;

/**
 * Typed phase union: Only registered phase constants are allowed
 */
export type ErrorPhase = (typeof ERROR_PHASES)[keyof typeof ERROR_PHASES];

/**
 * Type guard: Validate that a string is a registered error phase
 *
 * @param phase - String to validate
 * @returns true if phase is a valid ERROR_PHASES value
 */
export function isValidErrorPhase(phase: unknown): phase is ErrorPhase {
  if (typeof phase !== 'string') return false;
  return Object.values(ERROR_PHASES).includes(phase as ErrorPhase);
}

/**
 * Parse and validate a phase string with fallback
 *
 * @param phase - Phase string to parse
 * @returns Valid ErrorPhase or UNKNOWN as fallback
 */
export function parseErrorPhase(phase: unknown): ErrorPhase {
  if (isValidErrorPhase(phase)) {
    return phase;
  }
  // Fallback to UNKNOWN for unregistered phases (typos, legacy strings)
  return ERROR_PHASES.UNKNOWN;
}
