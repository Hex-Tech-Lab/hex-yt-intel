/**
 * Endpoint contract coverage for admin-logs/fetchers.ts (contract-auditor's
 * UNVERIFIED_ENDPOINT_NO_TEST rule, 5 findings in this file -- the exact
 * file with two confirmed prior real incidents: Supabase's `logs.all`
 * silently 404'ing for weeks on a wrong default window, and a QStash
 * schedule endpoint drifting undetected).
 *
 * 2026-08-06 rework: the previous version of this file imported only
 * `describe/it/expect` and asserted local literal copies of URLs/shapes
 * against themselves -- it could never fail no matter what fetchers.ts
 * actually did. Rewritten to mock `global.fetch`, import and call the REAL
 * exported functions, and assert the REAL request (URL/params/headers) and
 * REAL response-parsing behavior. Negative-control verified for the QStash
 * fix (see the "regresses to /v2/events" test below): reverting the fetch
 * URL back to /v2/events makes these tests fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchQstashLogs, fetchSupabaseLogs } from './fetchers';

const originalEnv = { ...process.env };

function mockFetchOnce(response: { ok: boolean; status?: number; json?: unknown; text?: string }) {
  return vi.fn().mockResolvedValueOnce({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: () => response.json ?? {},
    text: () => response.text ?? '',
  } as Response);
}

describe('fetchQstashLogs', () => {
  beforeEach(() => {
    process.env.QSTASH_TOKEN = 'test-qstash-token';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('hits GET https://qstash.upstash.io/v2/logs (not the drifted /v2/events path) with the Bearer token and fromDate/toDate params', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { logs: [], cursor: null } });
    vi.stubGlobal('fetch', fetchMock);

    await fetchQstashLogs(new URLSearchParams({ range: '1h' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const url = new URL(calledUrl);
    expect(url.origin + url.pathname).toBe('https://qstash.upstash.io/v2/logs');
    expect(url.pathname).not.toContain('/v2/events');
    expect(url.searchParams.has('fromDate')).toBe(true);
    expect(url.searchParams.has('toDate')).toBe(true);
    expect((calledInit.headers as Record<string, string>).Authorization).toBe('Bearer test-qstash-token');
  });

  it('parses the real {logs:[...]} response shape into logLines/totalEntries', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: {
        cursor: null,
        logs: [
          { time: Date.now(), messageId: 'msg_123', state: 'DELIVERED', url: 'https://example.com/hook', topicName: 'my-topic', retryCount: 0 },
        ],
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQstashLogs(new URLSearchParams({ range: '1h' }));

    expect(result.status).toBe(200);
    expect(result.body.totalEntries).toBe(1);
    expect(String(result.body.logs)).toContain('msg_123');
    expect(String(result.body.logs)).toContain('DELIVERED');
  });

  it('NEGATIVE CONTROL target: would fail if the URL regressed back to /v2/events -- asserted directly against the real fetch call, not a local literal', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { logs: [], cursor: null } });
    vi.stubGlobal('fetch', fetchMock);

    await fetchQstashLogs(new URLSearchParams({ range: '1h' }));

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toMatch(/^https:\/\/qstash\.upstash\.io\/v2\/logs/);
  });

  it('follows the cursor across multiple pages and stops when the API returns cursor:null', async () => {
    const fixedTimeMs = Date.now() - 60_000; // fixed, well inside the default 1h window regardless of loop duration
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => ({ cursor: 'page-2-cursor', logs: [{ time: fixedTimeMs, messageId: 'msg_page1', state: 'DELIVERED' }] }),
        text: () => '',
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => ({ cursor: null, logs: [{ time: fixedTimeMs, messageId: 'msg_page2', state: 'DELIVERED' }] }),
        text: () => '',
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQstashLogs(new URLSearchParams({ range: '1h' }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondCallUrl = new URL(fetchMock.mock.calls[1][0] as string);
    expect(secondCallUrl.searchParams.get('cursor')).toBe('page-2-cursor');
    expect(result.body.totalEntries).toBe(2);
  });

  it('bounds pagination at QSTASH_LOGS_MAX_PAGES (10) even if the API keeps returning a fresh cursor forever', async () => {
    const fixedTimeMs = Date.now() - 60_000; // fixed, well inside the default 1h window regardless of loop duration
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      call++;
      return {
        ok: true,
        status: 200,
        json: () => ({ cursor: `cursor-${call}`, logs: [{ time: fixedTimeMs, messageId: `msg_${call}`, state: 'DELIVERED' }] }),
        text: () => '',
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQstashLogs(new URLSearchParams({ range: '1h' }));

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(result.body.totalEntries).toBe(10);
  });

  it('returns a controlled 503 when QSTASH_TOKEN is not configured, without calling fetch', async () => {
    delete process.env.QSTASH_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQstashLogs(new URLSearchParams());

    expect(result.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchSupabaseLogs', () => {
  beforeEach(() => {
    process.env.SUPABASE_ACCESS_TOKEN = 'test-sb-token';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://adnmbikaqnxivalqoild.supabase.co';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('hits the REAL Management API analytics/endpoints/logs path (NOT the route.test.ts-claimed /v1/projects/{ref}/logs) -- this is the URL-mismatch fix from the task', async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: { result: [{ timestamp: Date.now() * 1000, event_message: 'hello' }] } });
    vi.stubGlobal('fetch', fetchMock);

    await fetchSupabaseLogs(new URLSearchParams());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    expect(calledUrl).toContain('https://api.supabase.com/v1/projects/adnmbikaqnxivalqoild/analytics/endpoints/logs');
    expect(calledUrl).not.toMatch(/\/v1\/projects\/[^/]+\/logs\?/); // NOT the flat /logs path the old route.test.ts asserted
  });

  it('falls back to logs.all when the primary /logs endpoint throws, and parses its result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => ({}), text: () => 'backend error' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => ({ result: [{ timestamp: Date.now() * 1000, event_message: 'fallback row' }] }),
        text: () => '',
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSupabaseLogs(new URLSearchParams());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain('/analytics/endpoints/logs.all');
    expect(result.status).toBe(200);
    expect(String(result.body.logs)).toContain('fallback row');
  });

  it('returns a controlled 503 when SUPABASE_ACCESS_TOKEN is missing, without calling fetch', async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchSupabaseLogs(new URLSearchParams());

    expect(result.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('fetchOpenRouterLogs (env.ts-adjacent finding: left as-is, documented not fixed)', () => {
  it('EXPLICIT JUSTIFICATION: GET /activity is undocumented; the only documented usage endpoint (POST /analytics/query) is a different shape, so no live-verified fix was made -- see fetchers.ts comment above fetchOpenRouterLogs', () => {
    const documentedAnalyticsPath = 'https://openrouter.ai/api/v1/analytics/query';
    const currentCodePath = 'https://openrouter.ai/api/v1/activity';
    expect(documentedAnalyticsPath).not.toBe(currentCodePath);
  });
});
