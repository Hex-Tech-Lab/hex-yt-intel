import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSentryLogs } from '@/lib/admin-logs/fetchers';

describe('fetchSentryLogs 401/403 fail-soft', () => {
  const originalFetch = global.fetch;
  const originalToken = process.env.SENTRY_LOGS_AUTH_TOKEN;

  beforeEach(() => {
    process.env.SENTRY_LOGS_AUTH_TOKEN = 'test-token';
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.SENTRY_LOGS_AUTH_TOKEN;
    else process.env.SENTRY_LOGS_AUTH_TOKEN = originalToken;
  });

  it('returns 200 with empty issues and warning on 401', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' } as unknown as Response);
    const result = await fetchSentryLogs(new URLSearchParams());
    expect(result.status).toBe(200);
    expect(result.body.issues).toEqual([]);
    expect(result.body.warning).toMatch(/Invalid or expired SENTRY_AUTH_TOKEN/);
  });

  it('returns 200 with empty issues and warning on 403', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'Forbidden' } as unknown as Response);
    const result = await fetchSentryLogs(new URLSearchParams());
    expect(result.status).toBe(200);
    expect((result.body.warning as string)).toContain('403');
  });

  it('returns 503 when token missing', async () => {
    delete process.env.SENTRY_LOGS_AUTH_TOKEN;
    const result = await fetchSentryLogs(new URLSearchParams());
    expect(result.status).toBe(503);
  });
});
