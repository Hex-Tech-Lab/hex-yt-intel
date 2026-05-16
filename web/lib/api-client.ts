export interface RateLimitError {
  status: 429;
  message: string;
  retryAfter: number; // seconds
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  rateLimitError?: RateLimitError;
  headers: {
    retryAfter?: number;
  };
}

/**
 * Centralized API client with rate-limit detection and Retry-After extraction
 */
export async function apiCall<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const headers = response.headers;
    const retryAfterHeader = headers.get('Retry-After');
    let retryAfter: number | undefined;

    if (retryAfterHeader) {
      const parsed = parseInt(retryAfterHeader, 10);
      retryAfter = isNaN(parsed) ? 60 : parsed; // Default to 60 if invalid
    }

    const responseData = await response.json().catch(() => null);

    // Handle rate limiting (429 Too Many Requests)
    if (response.status === 429) {
      const retrySeconds = retryAfter || 60; // Fallback to 60 seconds if no header
      const rateLimitError: RateLimitError = {
        status: 429,
        message: responseData?.error || 'Rate limit exceeded. Please try again later.',
        retryAfter: retrySeconds,
      };

      return {
        ok: false,
        status: response.status,
        error: rateLimitError.message,
        rateLimitError,
        headers: { retryAfter: retrySeconds },
      };
    }

    // Handle other errors
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: responseData?.error || `HTTP ${response.status}`,
        headers: { retryAfter },
      };
    }

    // Success
    return {
      ok: true,
      status: response.status,
      data: responseData as T,
      headers: { retryAfter },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return {
      ok: false,
      status: 0,
      error: message,
      headers: {},
    };
  }
}
