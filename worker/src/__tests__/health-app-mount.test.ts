/**
 * App-level contract test: the REAL worker app must serve
 * GET /health/providers at exactly /health/providers — the exact URL the
 * deploy workflow probes (.github/workflows/deploy-worker.yml). The route
 * is registered via `app.route("/", health)` (worker/src/worker.ts), so the
 * path must NOT double-prefix to /health/health/providers. Guards the
 * wiring, not just the sub-router (the sub-router shape is covered by
 * health-providers.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';

// @sentry/cloudflare's SDK init touches Cloudflare-specific runtime globals
// (execution-context flush locks) that don't exist in Node. Two mocks are
// needed: @sentry/hono/cloudflare's `sentry()` wraps the app's fetch with
// @sentry/cloudflare via its OWN nested dependency copy (pnpm), so mocking
// the bare '@sentry/cloudflare' specifier alone doesn't intercept it.
vi.mock('@sentry/cloudflare', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));
vi.mock('@sentry/hono/cloudflare', () => ({
  sentry: vi.fn(() => (_c, next) => next()),
}));

import worker from '../worker';

describe('GET /health/providers (app-level mount)', () => {
  it('serves the providers report at exactly /health/providers through the real app', async () => {
    let status = 0;
    let body: Record<string, boolean> | undefined;
    try {
      const res = await worker.fetch(
        new Request('https://yt-intel.hex-tech-lab.workers.dev/health/providers'),
        { TRANSCRIPTAPI_API_KEY: 'k', YOUTUBE_API_KEY: '', COMMENTS_TIER3_QUEUE: {} as never } as never,
        {} as never,
      );
      status = res.status;
      body = (await res.json()) as Record<string, boolean>;
    } finally {
      // Response fully consumed above; mock runtime holds no resources to release.
    }
    expect(status).toBe(200);
    expect(body?.transcriptapi).toBe(true);
    expect(body?.youtube).toBe(false);
    // Booleans only, never values.
    expect(Object.values(body ?? {}).every((v) => typeof v === 'boolean')).toBe(true);
  });

  it('does NOT serve a doubled /health/health/providers prefix', async () => {
    let status = 0;
    try {
      const res = await worker.fetch(
        new Request('https://yt-intel.hex-tech-lab.workers.dev/health/health/providers'),
        {} as never,
        {} as never,
      );
      status = res.status;
    } finally {
      // 404 body intentionally unread; mock runtime holds no resources to release.
    }
    expect(status).toBe(404);
  });
});
