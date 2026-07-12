/**
 * Comprehensive error handler tests
 *
 * Tests type-safe error categorization, retry logic, and status codes.
 * Ensures single source of truth for error handling across all routes.
 */

import {
  categorizeError,
  captureErrorToSentry,
  logError,
  createErrorResponse,
  type CategorizedError,
} from '@/lib/services/error-handler';
import { ERROR_PHASES } from '@/lib/error-codes';
import * as Sentry from '@sentry/nextjs';

// Mock Sentry
jest.mock('@sentry/nextjs');
const mockCaptureSentry = Sentry.captureException as jest.MockedFunction<typeof Sentry.captureException>;

describe('error-handler: categorizeError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Request Validation Phase', () => {
    it('should categorize REQUEST_VALIDATION phase as 400 non-retryable', () => {
      const result = categorizeError(new Error('Invalid JSON'), ERROR_PHASES.REQUEST_VALIDATION);

      expect(result).toEqual({
        category: 'request_validation',
        code: 'INVALID_REQUEST',
        message: 'Invalid JSON',
        retryable: false,
        statusCode: 400,
      });
    });

    it('should categorize JSON_PARSE phase as 400 non-retryable', () => {
      const result = categorizeError(new SyntaxError('Unexpected token'), ERROR_PHASES.JSON_PARSE);

      expect(result.statusCode).toBe(400);
      expect(result.retryable).toBe(false);
      expect(result.category).toBe('request_validation');
    });

    it('should categorize SCHEMA_VALIDATION phase as 400 non-retryable', () => {
      const result = categorizeError(new Error('Missing required field'), ERROR_PHASES.SCHEMA_VALIDATION);

      expect(result.statusCode).toBe(400);
      expect(result.retryable).toBe(false);
    });
  });

  describe('Authentication Phase', () => {
    it('should categorize AUTHENTICATION phase as 401 non-retryable', () => {
      const result = categorizeError(new Error('No auth token'), ERROR_PHASES.AUTHENTICATION);

      expect(result).toEqual({
        category: 'authentication',
        code: 'UNAUTHORIZED',
        message: 'No auth token',
        retryable: false,
        statusCode: 401,
      });
    });

    it('should categorize SIGNATURE_VERIFICATION timeout as 503 retryable', () => {
      const result = categorizeError(
        new Error('Signature verification timeout'),
        ERROR_PHASES.SIGNATURE_VERIFICATION
      );

      expect(result.statusCode).toBe(503);
      expect(result.retryable).toBe(true);
      expect(result.code).toBe('INVALID_SIGNATURE');
    });

    it('should categorize SIGNATURE_VERIFICATION non-timeout as 401 non-retryable', () => {
      const result = categorizeError(
        new Error('Invalid signature format'),
        ERROR_PHASES.SIGNATURE_VERIFICATION
      );

      expect(result.statusCode).toBe(401);
      expect(result.retryable).toBe(false);
    });
  });

  describe('Authorization Phase', () => {
    it('should categorize AUTHORIZATION phase as 403 non-retryable', () => {
      const result = categorizeError(new Error('Forbidden resource'), ERROR_PHASES.AUTHORIZATION);

      expect(result).toEqual({
        category: 'authorization',
        code: 'FORBIDDEN',
        message: 'Forbidden resource',
        retryable: false,
        statusCode: 403,
      });
    });

    it('should categorize OWNERSHIP_CHECK phase as 404 non-retryable', () => {
      const result = categorizeError(new Error('Not found'), ERROR_PHASES.OWNERSHIP_CHECK);

      expect(result.statusCode).toBe(404);
      expect(result.retryable).toBe(false);
      expect(result.code).toBe('UNAUTHORIZED');
    });
  });

  describe('Rate Limiting Phase', () => {
    it('should categorize RATE_LIMIT phase as 429 retryable', () => {
      const result = categorizeError(new Error('Rate limit exceeded'), ERROR_PHASES.RATE_LIMIT);

      expect(result).toEqual({
        category: 'rate_limit',
        code: 'RATE_LIMITED',
        message: 'Rate limit exceeded',
        retryable: true,
        statusCode: 429,
      });
    });

    it('should categorize QUOTA_CHECK phase as 429 retryable', () => {
      const result = categorizeError(new Error('Monthly quota exhausted'), ERROR_PHASES.QUOTA_CHECK);

      expect(result.statusCode).toBe(429);
      expect(result.retryable).toBe(true);
      expect(result.category).toBe('rate_limit');
    });
  });

  describe('Database Fetch Phase', () => {
    it('should categorize DATABASE_FETCH with timeout as 503 retryable', () => {
      const result = categorizeError(
        new Error('Connection timeout'),
        ERROR_PHASES.DATABASE_FETCH
      );

      expect(result).toEqual({
        category: 'database_fetch',
        code: 'DB_FETCH_ERROR',
        message: 'Connection timeout',
        retryable: true,
        statusCode: 503,
      });
    });

    it('should categorize DATABASE_FETCH with ECONNRESET as retryable', () => {
      const result = categorizeError(new Error('ECONNRESET'), ERROR_PHASES.DATABASE_FETCH);

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('should categorize DATABASE_FETCH with ETIMEDOUT as retryable', () => {
      const result = categorizeError(new Error('ETIMEDOUT'), ERROR_PHASES.DATABASE_FETCH);

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('should categorize DATABASE_FETCH without timeout as 500 non-retryable', () => {
      const result = categorizeError(new Error('Constraint violation'), ERROR_PHASES.DATABASE_FETCH);

      expect(result.statusCode).toBe(500);
      expect(result.retryable).toBe(false);
    });

    it('should categorize CACHE_LOOKUP timeout as 503 retryable', () => {
      const result = categorizeError(new Error('Cache timeout'), ERROR_PHASES.CACHE_LOOKUP);

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('should categorize IDEMPOTENCY_CHECK as database fetch behavior', () => {
      const result = categorizeError(new Error('Lookup failed'), ERROR_PHASES.IDEMPOTENCY_CHECK);

      expect(result.category).toBe('database_fetch');
    });
  });

  describe('Database Write Phase', () => {
    it('should categorize DATABASE_WRITE with timeout as 503 retryable', () => {
      const result = categorizeError(new Error('Write timeout'), ERROR_PHASES.DATABASE_WRITE);

      expect(result).toEqual({
        category: 'database_write',
        code: 'DB_WRITE_ERROR',
        message: 'Write timeout',
        retryable: true,
        statusCode: 503,
      });
    });

    it('should categorize DATABASE_WRITE with ECONNRESET as retryable', () => {
      const result = categorizeError(new Error('ECONNRESET'), ERROR_PHASES.DATABASE_WRITE);

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('should categorize DATABASE_WRITE with connection error as retryable', () => {
      const result = categorizeError(
        new Error('Connection refused'),
        ERROR_PHASES.DATABASE_WRITE
      );

      expect(result.retryable).toBe(true);
    });

    it('should categorize DATABASE_WRITE without transient error as 500 non-retryable', () => {
      const result = categorizeError(new Error('Unique constraint violation'), ERROR_PHASES.DATABASE_WRITE);

      expect(result.statusCode).toBe(500);
      expect(result.retryable).toBe(false);
    });
  });

  describe('External Service Phase', () => {
    it('should categorize EMBEDDING_GENERATION with timeout as 503 retryable', () => {
      const result = categorizeError(
        new Error('Embedding service timeout'),
        ERROR_PHASES.EMBEDDING_GENERATION
      );

      expect(result).toEqual({
        category: 'external_service',
        code: 'SERVICE_TIMEOUT',
        message: 'Embedding service timeout',
        retryable: true,
        statusCode: 503,
      });
    });

    it('should categorize EMBEDDING_GENERATION without timeout as 502 non-retryable', () => {
      const result = categorizeError(
        new Error('Embedding service unavailable'),
        ERROR_PHASES.EMBEDDING_GENERATION
      );

      expect(result.statusCode).toBe(502);
      expect(result.retryable).toBe(false);
      expect(result.code).toBe('SERVICE_ERROR');
    });

    it('should categorize VECTOR_SEARCH with rate limit as 503 retryable', () => {
      const result = categorizeError(
        new Error('Rate limit: 429'),
        ERROR_PHASES.VECTOR_SEARCH
      );

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
      expect(result.code).toBe('SERVICE_RATE_LIMIT');
    });

    it('should categorize VECTOR_SEARCH with timeout as retryable', () => {
      const result = categorizeError(
        new Error('Vector search timeout'),
        ERROR_PHASES.VECTOR_SEARCH
      );

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });

    it('should categorize EXTERNAL_SERVICE with quota error as retryable', () => {
      const result = categorizeError(new Error('Quota exceeded'), ERROR_PHASES.EXTERNAL_SERVICE);

      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
    });
  });

  describe('Result Enrichment Phase', () => {
    it('should categorize RESULT_ENRICHMENT with timeout as 503 retryable', () => {
      const result = categorizeError(new Error('Enrichment timeout'), ERROR_PHASES.RESULT_ENRICHMENT);

      expect(result.statusCode).toBe(503);
      expect(result.retryable).toBe(true);
      expect(result.category).toBe('database_fetch');
    });

    it('should categorize RESULT_ENRICHMENT without timeout as 500 non-retryable', () => {
      const result = categorizeError(new Error('Enrichment failed'), ERROR_PHASES.RESULT_ENRICHMENT);

      expect(result.statusCode).toBe(500);
      expect(result.retryable).toBe(false);
    });
  });

  describe('Business Logic Phase', () => {
    it('should categorize BUSINESS_LOGIC phase as 400 non-retryable', () => {
      const result = categorizeError(
        new Error('Invalid video URL'),
        ERROR_PHASES.BUSINESS_LOGIC
      );

      expect(result).toEqual({
        category: 'business_logic',
        code: 'BUSINESS_LOGIC_ERROR',
        message: 'Invalid video URL',
        retryable: false,
        statusCode: 400,
      });
    });

    it('should categorize VALIDATION phase as business logic', () => {
      const result = categorizeError(new Error('Validation failed'), ERROR_PHASES.VALIDATION);

      expect(result.category).toBe('business_logic');
      expect(result.statusCode).toBe(400);
      expect(result.retryable).toBe(false);
    });

    it('should categorize CONSTRAINT_CHECK phase as business logic', () => {
      const result = categorizeError(new Error('Constraint failed'), ERROR_PHASES.CONSTRAINT_CHECK);

      expect(result.category).toBe('business_logic');
      expect(result.statusCode).toBe(400);
    });
  });

  describe('Network Timeout Phase', () => {
    it('should categorize NETWORK_TIMEOUT as 504 retryable', () => {
      const result = categorizeError(new Error('Connection timeout'), ERROR_PHASES.NETWORK_TIMEOUT);

      expect(result).toEqual({
        category: 'network_timeout',
        code: 'TIMEOUT',
        message: 'Connection timeout',
        retryable: true,
        statusCode: 504,
      });
    });
  });

  describe('Unknown Phase', () => {
    it('should categorize UNKNOWN phase as 500 retryable', () => {
      const result = categorizeError(new Error('Unknown error'), ERROR_PHASES.UNKNOWN);

      expect(result).toEqual({
        category: 'unknown',
        code: 'INTERNAL_ERROR',
        message: 'Unknown error',
        retryable: true,
        statusCode: 500,
      });
    });
  });

  describe('Error message extraction', () => {
    it('should extract message from Error instance', () => {
      const result = categorizeError(new Error('Test error'), ERROR_PHASES.REQUEST_VALIDATION);

      expect(result.message).toBe('Test error');
    });

    it('should extract message from string', () => {
      const result = categorizeError('String error', ERROR_PHASES.REQUEST_VALIDATION);

      expect(result.message).toBe('String error');
    });

    it('should extract message from unknown object', () => {
      const result = categorizeError({ msg: 'Object error' }, ERROR_PHASES.REQUEST_VALIDATION);

      expect(result.message).toBe('[object Object]');
    });

    it('should extract message from null', () => {
      const result = categorizeError(null, ERROR_PHASES.REQUEST_VALIDATION);

      expect(result.message).toBe('null');
    });

    it('should extract message from undefined', () => {
      const result = categorizeError(undefined, ERROR_PHASES.REQUEST_VALIDATION);

      expect(result.message).toBe('undefined');
    });
  });
});

describe('error-handler: captureErrorToSentry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should capture error with all tags', () => {
    const error = new Error('Test error');
    const categorized: CategorizedError = {
      category: 'database_fetch',
      code: 'DB_FETCH_ERROR',
      message: 'Database connection failed',
      retryable: true,
      statusCode: 503,
    };

    captureErrorToSentry(error, 'test-operation', categorized, ERROR_PHASES.DATABASE_FETCH, {
      userId: 'user-123',
      videoId: 'video-456',
    });

    expect(mockCaptureSentry).toHaveBeenCalledWith(error, {
      tags: {
        operation: 'test-operation',
        phase: ERROR_PHASES.DATABASE_FETCH,
        category: 'database_fetch',
        code: 'DB_FETCH_ERROR',
        retryable: 'true',
        statusCode: '503',
      },
      contexts: {
        error: {
          category: 'database_fetch',
          message: 'Database connection failed',
          retryable: true,
        },
        api: {
          userId: 'user-123',
          videoId: 'video-456',
        },
      },
    });
  });

  it('should capture error with default phase when not provided', () => {
    const error = new Error('Test error');
    const categorized: CategorizedError = {
      category: 'unknown',
      code: 'INTERNAL_ERROR',
      message: 'Unknown error',
      retryable: true,
      statusCode: 500,
    };

    captureErrorToSentry(error, 'test-operation', categorized);

    expect(mockCaptureSentry).toHaveBeenCalled();
    const callArgs = mockCaptureSentry.mock.calls[0][1];
    expect(callArgs?.tags?.phase).toBe('unknown');
  });
});

describe('error-handler: logError', () => {
  const consoleSpy = {
    error: jest.spyOn(console, 'error').mockImplementation(),
    warn: jest.spyOn(console, 'warn').mockImplementation(),
    info: jest.spyOn(console, 'info').mockImplementation(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should log error-level for 5xx status codes', () => {
    const categorized: CategorizedError = {
      category: 'database_fetch',
      code: 'DB_FETCH_ERROR',
      message: 'Database error',
      retryable: true,
      statusCode: 503,
    };

    logError('[test]', 'db-query', categorized);

    expect(consoleSpy.error).toHaveBeenCalled();
  });

  it('should log warn-level for 4xx status codes', () => {
    const categorized: CategorizedError = {
      category: 'request_validation',
      code: 'INVALID_REQUEST',
      message: 'Invalid input',
      retryable: false,
      statusCode: 400,
    };

    logError('[test]', 'validation', categorized);

    expect(consoleSpy.warn).toHaveBeenCalled();
  });

  it('should log info-level for 2xx status codes', () => {
    const categorized: CategorizedError = {
      category: 'unknown',
      code: 'INTERNAL_ERROR',
      message: 'Info message',
      retryable: false,
      statusCode: 200,
    };

    logError('[test]', 'info', categorized);

    expect(consoleSpy.info).toHaveBeenCalled();
  });

  it('should include context in log', () => {
    const categorized: CategorizedError = {
      category: 'authentication',
      code: 'UNAUTHORIZED',
      message: 'Auth failed',
      retryable: false,
      statusCode: 401,
    };

    logError('[test]', 'auth', categorized, { userId: 'user-123', requestId: 'req-456' });

    expect(consoleSpy.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      userId: 'user-123',
      requestId: 'req-456',
    }));
  });
});

describe('error-handler: createErrorResponse', () => {
  it('should create error response with all fields', () => {
    const categorized: CategorizedError = {
      category: 'request_validation',
      code: 'INVALID_REQUEST',
      message: 'Invalid JSON',
      retryable: false,
      statusCode: 400,
    };

    const response = createErrorResponse(categorized);

    expect(response).toEqual({
      error: 'Invalid JSON',
      code: 'INVALID_REQUEST',
    });
  });

  it('should include retryable flag when true', () => {
    const categorized: CategorizedError = {
      category: 'database_fetch',
      code: 'DB_FETCH_ERROR',
      message: 'Timeout',
      retryable: true,
      statusCode: 503,
    };

    const response = createErrorResponse(categorized);

    expect(response).toEqual({
      error: 'Timeout',
      code: 'DB_FETCH_ERROR',
      retryable: true,
    });
  });

  it('should omit retryable flag when false', () => {
    const categorized: CategorizedError = {
      category: 'authentication',
      code: 'UNAUTHORIZED',
      message: 'Auth failed',
      retryable: false,
      statusCode: 401,
    };

    const response = createErrorResponse(categorized);

    expect(response).not.toHaveProperty('retryable');
  });
});
