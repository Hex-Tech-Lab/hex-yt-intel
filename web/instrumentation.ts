/**
 * Next.js instrumentation for Sentry
 * Runs once when the server starts
 *
 * This file is loaded before any application code runs,
 * allowing us to initialize Sentry and other observability tools
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 1. DSN GUARD (NEW)
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
      console.warn('[instrumentation.ts] Sentry DSN missing, skipping init.');
    } else {
      // 2. PRESERVE EXISTING CONFIG
      await import('./sentry.server.config');
    }
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // 3. PRESERVE EXISTING CONFIG
    await import('./sentry.edge.config');
  }
}
