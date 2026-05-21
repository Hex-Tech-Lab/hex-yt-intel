/**
 * External Service Mocks
 * Fixtures for OpenRouter, Upstash Redis, Stripe, and other external services
 * Used to simulate various network conditions and error scenarios
 */

/**
 * OpenRouter API mock responses
 */
export const openrouterMocks = {
  // Successful analysis response
  successResponse: {
    id: 'gen-123456',
    created: Math.floor(Date.now() / 1000),
    choices: [
      {
        message: {
          role: 'assistant',
          content: `# YouTube Content Intelligence Analysis

**Video**: Test Video
**Duration**: 10 minutes

## 1. Executive Summary
This is a test analysis...

## 2. Key Concepts
...

## 3. Target Audience
...`,
        finish_reason: 'stop',
        stop_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 850,
      total_tokens: 2050,
    },
  },

  // Timeout response (simulated via delay)
  timeoutResponse: {
    delay: 11000, // 11 seconds (exceeds default timeout)
    error: null, // Actual HTTP timeout, not API error
  },

  // Rate limit response
  rateLimitResponse: {
    status: 429,
    error: {
      message: 'Rate limit exceeded',
      type: 'invalid_request_error',
    },
  },

  // Invalid API key response
  invalidKeyResponse: {
    status: 401,
    error: {
      message: 'Unauthorized: Invalid API key',
      type: 'authentication_error',
    },
  },

  // Model not found response
  modelNotFoundResponse: {
    status: 404,
    error: {
      message: 'Model not found: anthropic/claude-invalid',
      type: 'model_error',
    },
  },

  // Connection refused (network unavailable)
  connectionRefused: {
    error: 'ECONNREFUSED: Connection refused at 127.0.0.1:443',
    code: 'ECONNREFUSED',
  },
};

/**
 * Upstash Redis mock responses
 */
export const upstashMocks = {
  // Successful set operation
  setResponse: {
    result: 'OK',
  },

  // Successful get operation
  getResponse: {
    result: '2', // User has 2/3 analyses used
  },

  // Get on nonexistent key (new user)
  getNullResponse: {
    result: null,
  },

  // Successful increment operation
  incrResponse: {
    result: 3, // New count after increment
  },

  // Redis unavailable (connection timeout)
  connectionTimeout: {
    error: 'ETIMEOUT: Connection timed out at redis.upstash.io:443',
    code: 'ETIMEOUT',
    timeout: 5000,
  },

  // Redis authentication failed
  authError: {
    error: 'WRONGPASS invalid username-password pair',
    code: 'ERR',
  },

  // Rate limit from Upstash API
  rateLimitError: {
    error: 'Rate limit exceeded. Maximum 100 commands per second.',
    code: 'RATE_LIMITED',
  },
};

/**
 * Stripe mock responses
 */
export const stripeMocks = {
  // Successful charge creation
  chargeSuccess: {
    id: 'ch_1A2B3C4D5E6F7G8H',
    object: 'charge',
    amount: 900, // $9.00 in cents
    currency: 'usd',
    status: 'succeeded',
    paid: true,
    customer: 'cus_1A2B3C4D5E6F7G8H',
    created: Math.floor(Date.now() / 1000),
  },

  // Charge declined
  chargeDeclined: {
    id: 'ch_declined_123',
    object: 'charge',
    amount: 900,
    currency: 'usd',
    status: 'failed',
    paid: false,
    failure_code: 'card_declined',
    failure_message: 'Your card was declined',
  },

  // Webhook signature invalid
  webhookInvalidSignature: {
    error: 'Invalid signature. No signatures found matching the expected signature for payload.',
    code: 'sig_verification_failure',
  },

  // Webhook processing success
  webhookSuccess: {
    type: 'charge.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'ch_1A2B3C4D5E6F7G8H',
        amount: 900,
        customer: 'cus_1A2B3C4D5E6F7G8H',
      },
    },
  },
};

/**
 * Supabase mock responses
 */
export const supabaseMocks = {
  // Successful auth check
  authSuccess: {
    user: {
      id: 'user-123',
      email: 'test@example.com',
      user_metadata: {
        avatar_url: 'https://avatars.example.com/user.jpg',
      },
    },
    session: {
      access_token: 'token123',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    },
  },

  // Auth check failed (invalid token)
  authFailure: {
    error: {
      name: 'AuthSessionMissingError',
      message: 'Auth session not found',
      status: 401,
    },
  },

  // Connection timeout
  connectionTimeout: {
    error: {
      name: 'FetchError',
      message: 'Failed to connect to Supabase: ETIMEOUT',
      code: 'ETIMEOUT',
    },
  },

  // Database error
  databaseError: {
    error: {
      message: 'Relation "users" does not exist',
      code: '42P01',
      details: 'The table does not exist in the database',
    },
  },

  // RLS policy violation
  rlsViolation: {
    error: {
      message: 'new row violates row-level security policy',
      code: '42501',
      details: 'User does not have permission to insert rows',
    },
  },
};

/**
 * Network error simulations
 */
export const networkErrors = {
  // DNS resolution failure
  dnsError: {
    code: 'ENOTFOUND',
    message: 'getaddrinfo ENOTFOUND api.openrouter.ai',
    hostname: 'api.openrouter.ai',
  },

  // Connection reset
  connectionReset: {
    code: 'ECONNRESET',
    message: 'socket hang up',
  },

  // Socket timeout
  socketTimeout: {
    code: 'ESOCKETTIMEDOUT',
    message: 'socket timeout',
    timeout: 5000,
  },

  // HTTP 503 Service Unavailable
  serviceUnavailable: {
    status: 503,
    statusText: 'Service Unavailable',
    body: 'The server is temporarily unable to handle the request.',
  },

  // HTTP 504 Gateway Timeout
  gatewayTimeout: {
    status: 504,
    statusText: 'Gateway Timeout',
    body: 'The server did not receive a timely response from upstream.',
  },

  // Partial response (incomplete streaming)
  partialResponse: {
    chunks: [
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      // Stream cuts off here (connection lost)
    ],
    error: 'ECONNRESET: socket hang up',
  },
};

/**
 * Helper to create OpenRouter response with custom delay
 */
export function createOpenrouterResponse(
  content: string,
  delayMs: number = 0
) {
  return {
    ...openrouterMocks.successResponse,
    choices: [
      {
        ...openrouterMocks.successResponse.choices[0],
        message: {
          ...openrouterMocks.successResponse.choices[0].message,
          content,
        },
      },
    ],
    delay: delayMs,
  };
}

/**
 * Helper to simulate timeout by returning error after delay
 */
export function createTimeoutError(delayMs: number = 3000) {
  return {
    name: 'TimeoutError',
    message: 'Request timeout',
    code: 'ETIMEDOUT',
    timeout: delayMs,
  };
}

/**
 * Helper to create custom Stripe webhook
 */
export function createStripeWebhook(
  eventType: string,
  data: Record<string, unknown> = {}
) {
  return {
    id: `evt_${Date.now()}`,
    object: 'event',
    api_version: '2023-10-16',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: eventType,
    data: {
      object: data,
    },
  };
}

/**
 * Mock implementation status for tests
 */
export const mockStatus = {
  openrouter: {
    healthy: true,
    latency: 800, // ms
    lastError: null as string | null,
  },
  upstash: {
    healthy: true,
    latency: 50, // ms (very fast for Redis)
    lastError: null as string | null,
  },
  supabase: {
    healthy: true,
    latency: 200, // ms
    lastError: null as string | null,
  },
  stripe: {
    healthy: true,
    latency: 300, // ms
    lastError: null as string | null,
  },
};

/**
 * Helper to mark service as unhealthy for testing
 */
export function setServiceUnhealthy(
  service: keyof typeof mockStatus,
  error: string = 'Service unavailable'
) {
  mockStatus[service].healthy = false;
  mockStatus[service].lastError = error;
}

/**
 * Helper to restore service health
 */
export function restoreServiceHealth(service: keyof typeof mockStatus) {
  mockStatus[service].healthy = true;
  mockStatus[service].lastError = null;
}
