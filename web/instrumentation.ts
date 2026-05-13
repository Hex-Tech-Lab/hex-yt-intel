/**
 * Next.js instrumentation for Sentry
 * Runs once when the server starts
 *
 * This file is loaded before any application code runs,
 * allowing us to initialize Sentry and other observability tools
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Server-side initialization
    try {
      // sentry.config.js is loaded automatically by Next.js Sentry integration
      // This import ensures it's initialized during the register phase
      // eslint-disable-next-line -- require is needed for sentry initialization
      require('./sentry.config');
    } catch (_error) {
      // Sentry config may not be available in all environments
      console.debug('[instrumentation.ts] Sentry config not available');
    }
    console.log('[instrumentation.ts] Initialization complete for Node.js runtime');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    // Edge runtime initialization (if needed)
    console.log('[instrumentation.ts] Edge runtime detected');
  }
}
