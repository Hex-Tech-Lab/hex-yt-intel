/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). Rewritten 2026-08-06:
 * the previous version asserted a local string literal against itself and
 * never imported the route. This imports the REAL route, mocks
 * requireAdmin + fetchQstashLogs, invokes GET, and asserts real
 * delegation/auth/response-mapping behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdminMock = vi.fn();
const fetchQstashLogsMock = vi.fn();

vi.mock('@/lib/utils/require-admin', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/admin-logs/fetchers', () => ({ fetchQstashLogs: fetchQstashLogsMock }));

describe('GET /api/admin/logs/qstash', () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    fetchQstashLogsMock.mockReset();
  });

  it('returns 401 and never calls fetchQstashLogs when requireAdmin rejects', async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 401, error: 'Unauthorized' });
    const { GET } = await import('./route');

    const res = await GET(new Request('https://x/api/admin/logs/qstash') as any);

    expect(res.status).toBe(401);
    expect(fetchQstashLogsMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('delegates to the real fetchQstashLogs with the request searchParams and maps its status/body straight through', async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: true, userId: 'admin-1' });
    fetchQstashLogsMock.mockResolvedValueOnce({ status: 200, body: { totalEntries: 3, logs: 'x' } });
    const { GET } = await import('./route');

    const res = await GET(new Request('https://x/api/admin/logs/qstash?range=1h') as any);

    expect(fetchQstashLogsMock).toHaveBeenCalledTimes(1);
    const passedSearchParams = fetchQstashLogsMock.mock.calls[0][0] as URLSearchParams;
    expect(passedSearchParams.get('range')).toBe('1h');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalEntries).toBe(3);
  });
});
