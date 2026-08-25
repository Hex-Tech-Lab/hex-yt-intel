import * as Sentry from '@sentry/nextjs';

export function captureAdapterError(error: unknown, context: string, method: string, extra?: Record<string, unknown>): void {
  const msg = error instanceof Error ? error.message : String(error);
  console.warn(`[${context}] ${method} failed:`, msg);
  Sentry.captureException(error, { tags: { method }, extra });
}
