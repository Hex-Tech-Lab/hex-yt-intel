export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
      console.warn('[instrumentation.ts] Sentry DSN missing, skipping init.');
      return;
    }
    const Sentry = await import('@sentry/nextjs');
    Sentry.init({ dsn: process.env.NEXT_PUBLIC_SENTRY_DSN });
  }
}
