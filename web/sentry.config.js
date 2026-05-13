import * as Sentry from "@sentry/nextjs";

const environment = process.env.NODE_ENV || 'development'
const isDevelopment = environment === 'development'
const isProduction = environment === 'production'

Sentry.init({
  // DSN will be populated from NEXT_PUBLIC_SENTRY_DSN env var
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment tracking
  environment: environment,

  // Release tracking (for better grouping)
  release: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',

  // ===== TRACING CONFIGURATION =====
  // Enable performance monitoring
  enableTracing: true,

  // Trace sample rate: 100% in dev, 10% in prod (captures full transaction traces)
  tracesSampleRate: isDevelopment ? 1.0 : 0.1,

  // Profile sample rate: Sample 10% of transactions for profiling (prod only)
  profilesSampleRate: isProduction ? 0.1 : 1.0,

  // ===== SESSION REPLAY CONFIGURATION =====
  // Enable session replay for debugging
  replaysSessionSampleRate: 0.1, // 10% of sessions captured in prod, 100% in dev
  replaysOnErrorSampleRate: isProduction ? 1.0 : 1.0, // 100% of error sessions

  // Capture unhandled promise rejections
  captureUnhandledRejections: true,

  // Ignore noisy errors
  ignoreErrors: [
    // Browser extensions
    'top.GLOBALS',
    // Network errors (transient, often retryable)
    'NetworkError',
    'Network error',
    'Network request failed',
    'Failed to fetch',
    'ECONNREFUSED',
    'ENOTFOUND',
    // User aborted
    'AbortError',
    'AbortSignal',
    // Third-party errors
    'chrome-extension://',
    'moz-extension://',
    // Common 404s (bot traffic)
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml',
    // CORS errors (expected for third-party resources)
    'SecurityError',
  ],

  // Denylist patterns (never send these errors)
  denyUrls: [
    // Browser extensions
    /extensions\//i,
    /^chrome:\/\//i,
  ],

  // Server-side filtering
  beforeSend(event, hint) {
    // Remove sensitive API paths from URLs
    if (event.request) {
      const url = event.request.url || '';
      event.request.url = url
        .replace(/\/api\/stripe\/.*/, '/api/stripe/[redacted]')
        .replace(/\/api\/auth\/.*/, '/api/auth/[redacted]')
        .replace(/key=[^&]+/gi, 'key=[redacted]')
        .replace(/token=[^&]+/gi, 'token=[redacted]')
    }

    // Remove authorization headers
    if (event.request?.headers) {
      delete event.request.headers['Authorization']
      delete event.request.headers['authorization']
    }

    // Don't send if sampling is disabled
    if (event.fingerprint && event.fingerprint[0] === 'ignore') {
      return null
    }

    // Sample low-severity, high-volume errors in production
    if (isProduction && event.level === 'warning') {
      // Sample 50% of warnings to reduce noise
      if (Math.random() > 0.5) {
        return null
      }
    }

    return event
  },

  // Allow URLs (whitelist for server-side telemetry)
  allowUrls: [
    // Your own domain
    /hex-yt-intel\.vercel\.app/i,
    /localhost:\d+/i,
    // Trusted third-parties
    /cloudflare\.com/i,
    /supabase\.com/i,
  ],

  // Integrations
  integrations: [
    // Session Replay: Captures user interactions for debugging errors
    new Sentry.Replay({
      maskAllText: true,
      maskAllInputs: true,
      blockAllMedia: true,
    }),

    // HTTP Client Instrumentation: Tracks fetch/XMLHttpRequest
    new Sentry.Fetch({
      // Capture breadcrumbs for all HTTP requests
      breadcrumbs: true,
      // Fail silently if fetch tracking fails
      failedRequestStatusCodes: [500, 502, 503, 504],
    }),

    // Router instrumentation (Next.js)
    new Sentry.NextjsIntegration({
      // Automatically track page navigation
      autoSessionTracking: true,
    }),
  ],

  // Max breadcrumbs to keep (older breadcrumbs are discarded)
  maxBreadcrumbs: 100,

  // Attach HTTP client errors to breadcrumbs
  attachStacktrace: true,

  // Server-side options
  serverName: 'hex-yt-intel-server',

  // Custom headers for outbound requests
  httpClient: {
    request: {
      headers: {
        'X-Service': 'hex-yt-intel',
      },
    },
  },

  // Auto session tracking
  autoSessionTracking: true,

  // Initial scope setup
  initialScope: {
    tags: {
      environment: environment,
      version: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',
    },
  },
});
