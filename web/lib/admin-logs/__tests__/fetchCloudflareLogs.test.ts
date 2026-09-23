/**
 * Contract coverage for fetchCloudflareLogs (admin-logs/fetchers.ts).
 *
 * RCA (2026-09-24): the fetcher queried workersInvocationsAdaptive with NO
 * datetime filter (limit 50, orderBy datetime_DESC), so scripts/poll-logs-
 * snapshot.sh returned totalEntries: 0 while the worker had 78+ invocations
 * in the window. A correct query with filter:{datetime_geq,datetime_leq}
 * returns data with the same credentials. This file pins the fixed contract:
 * the time window is pushed INTO the GraphQL filter, and the Workers
 * Observability telemetry endpoint (persist=true in worker/wrangler.toml) is
 * queried for per-request outcomes (e.g. exceededCpu) that the aggregate
 * dataset cannot show.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCloudflareLogs } from '../fetchers';

const originalEnv = { ...process.env };

function okJson(json: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(json),
    text: () => Promise.resolve(''),
  } as Response;
}

describe('fetchCloudflareLogs', () => {
  beforeEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = 'test-cf-token';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account-id';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pushes the requested time window into the GraphQL datetime filter (NEGATIVE CONTROL: old code sent no filter)', async () => {
    const start = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const end = new Date().toISOString();
    const graphqlMock = vi.fn().mockResolvedValueOnce(okJson({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [] }] } } }));
    const obsMock = vi.fn().mockResolvedValueOnce(okJson({ result: { events: { events: [] } } }));
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes("/graphql") ? graphqlMock(input, init) : obsMock(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchCloudflareLogs(new URLSearchParams({ range: 'custom', start, end }));

    expect(graphqlMock).toHaveBeenCalledTimes(1);
    const [graphqlUrl, graphqlInit] = graphqlMock.mock.calls[0] as [string, RequestInit];
    expect(graphqlUrl).toBe('https://api.cloudflare.com/client/v4/graphql');
    const body = JSON.parse(graphqlInit.body as string) as { variables: { datetime_geq: string; datetime_leq: string }; query: string };
    expect(body.variables.datetime_geq).toBe(start);
    expect(body.variables.datetime_leq).toBe(end);
    expect(body.query).toContain('datetime_geq: $datetime_geq');
    // Old code's query had no filter at all — this assertion fails against it.
    expect(body.query).toContain('filter: { datetime_geq: $datetime_geq, datetime_leq: $datetime_leq }');
  });

  it('queries Workers Observability telemetry for per-request errors/outcomes and formats them into the snapshot', async () => {
    const now = Date.now();
    const graphqlMock = vi.fn().mockResolvedValueOnce(
      okJson({
        data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ dimensions: { scriptName: 'yt-intel', status: 'success', datetime: new Date(now - 1000).toISOString() }, quantiles: { cpuTimeP50: 5 }, sum: { errors: 0 } }] }] } },
      }),
    );
    const obsMock = vi.fn().mockResolvedValueOnce(
      okJson({
        // Real API shape (live-verified 2026-09-24): result.events.events[]
        result: {
          events: {
            events: [
              {
                timestamp: now - 500,
                $metadata: { error: 'Worker exceeded CPU time limit.', rayId: 'ray-1', service: 'yt-intel' },
                $workers: { scriptName: 'yt-intel', outcome: 'exceededCpu' },
              },
            ],
          },
        },
      }),
    );
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/graphql')) return graphqlMock();
      expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/test-account-id/workers/observability/telemetry/query');
      const body = JSON.parse(init?.body as string) as { timeframe: { from: number; to: number }; view: string };
      expect(body.view).toBe('events');
      expect(typeof body.timeframe.from).toBe('number');
      expect(typeof body.timeframe.to).toBe('number');
      return obsMock();
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchCloudflareLogs(new URLSearchParams({ range: '1h' }));

    expect(res.status).toBe(200);
    expect(res.body.totalEntries).toBe(2);
    const logs = res.body.logs as string;
    expect(logs).toContain('[cf-worker:yt-intel]');
    expect(logs).toContain('outcome=exceededCpu');
    expect(logs).toContain('ray-1');
    expect((res.body as Record<string, unknown>).observabilityEvents).toHaveLength(1);
  });

  it('degrades to a warning line (still 200) when the Observability call fails, keeping GraphQL data', async () => {
    const now = Date.now();
    const graphqlMock = vi.fn().mockResolvedValueOnce(
      okJson({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ dimensions: { scriptName: 'yt-intel', status: 'success', datetime: new Date(now).toISOString() }, quantiles: { cpuTimeP50: 3 }, sum: { errors: 0 } }] }] } } }),
    );
    const obsMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, json: () => Promise.resolve({}), text: () => Promise.resolve('forbidden') } as Response);
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      return url.includes("/graphql") ? graphqlMock(input, init) : obsMock(input, init);
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await fetchCloudflareLogs(new URLSearchParams({ range: '1h' }));

    expect(res.status).toBe(200);
    expect(res.body.totalEntries).toBe(1);
    const body = res.body as Record<string, unknown>;
    expect(typeof body.warning).toBe('string');
    expect((body.warning as string)).toContain('Workers Observability query failed');
  });

  it('returns a controlled 503 when credentials are not configured, without calling fetch', async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchCloudflareLogs(new URLSearchParams({ range: '1h' }));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
