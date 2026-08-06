/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). Rewritten 2026-08-06:
 * the previous version asserted a local literal
 * "https://api.supabase.com/v1/projects/{ref}/logs" that CONTRADICTS the
 * real fetcher's endpoint (verified against fetchers.ts:
 * `.../v1/projects/${projectRef}/analytics/endpoints/${endpoint}?sql=...`,
 * a ClickHouse SQL analytics endpoint, not a flat `/logs` resource). That
 * flat-path claim is now confirmed WRONG and removed; this test instead
 * imports the real route, mocks requireAdmin + fetchSupabaseLogs, and
 * asserts real delegation/auth/response-mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdminMock = vi.fn();
const fetchSupabaseLogsMock = vi.fn();

vi.mock('@/lib/utils/require-admin', () => ({ requireAdmin: requireAdminMock }));
vi.mock('@/lib/admin-logs/fetchers', () => ({ fetchSupabaseLogs: fetchSupabaseLogsMock }));

describe('GET /api/admin/logs/supabase', () => {
  beforeEach(() => {
    requireAdminMock.mockReset();
    fetchSupabaseLogsMock.mockReset();
  });

  it('returns 403 and never calls fetchSupabaseLogs when requireAdmin denies a non-admin user', async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    const { GET } = await import('./route');

    const res = await GET(new Request('https://x/api/admin/logs/supabase') as any);

    expect(res.status).toBe(403);
    expect(fetchSupabaseLogsMock).not.toHaveBeenCalled();
  });

  it('delegates to the real fetchSupabaseLogs with the request searchParams and maps its status/body straight through', async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: true, userId: 'admin-1' });
    fetchSupabaseLogsMock.mockResolvedValueOnce({ status: 200, body: { totalEntries: 5, endpointUsed: 'logs' } });
    const { GET } = await import('./route');

    const res = await GET(new Request('https://x/api/admin/logs/supabase?range=today') as any);

    expect(fetchSupabaseLogsMock).toHaveBeenCalledTimes(1);
    const passedSearchParams = fetchSupabaseLogsMock.mock.calls[0][0] as URLSearchParams;
    expect(passedSearchParams.get('range')).toBe('today');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endpointUsed).toBe('logs');
  });
});
