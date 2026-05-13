import * as Sentry from "@sentry/nextjs";

const environment = process.env.NODE_ENV || 'development'

Sentry.init({
  // DSN will be populated from NEXT_PUBLIC_SENTRY_DSN env var
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment tracking
  environment: environment,

  // Tracing (sample rate: 10% in prod, 100% in dev)
  tracesSampleRate: environment === 'production' ? 0.1 : 1.0,

  // Capture unhandled promise rejections
  captureUnhandledRejections: true,

  // Ignore noisy errors
  ignoreErrors: [
    // Browser extensions
    'top.GLOBALS',
    // Network errors (transient)
    'NetworkError',
    'Network error',
    'Network request failed',
    // User aborted
    'AbortError',
    'AbortSignal',
    // Third-party errors
    'chrome-extension://',
    'moz-extension://',
  ],

  // Release tracking (for better grouping)
  release: process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0',

  // Filter sensitive data before sending
  beforeSend(event, hint) {
    // Remove sensitive API paths from URLs
    if (event.request) {
      const url = event.request.url || '';
      event.request.url = url
        .replace(/\/api\/stripe\/.*/, '/api/stripe/[redacted]')
        .replace(/\/api\/auth\/.*/, '/api/auth/[redacted]')
    }

    // Don't send if sampling is disabled
    if (event.fingerprint && event.fingerprint[0] === 'ignore') {
      return null
    }

    return event
  },

  // Integrations
  integrations: [
    new Sentry.Replay({
      // Capture DOM mutations
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
