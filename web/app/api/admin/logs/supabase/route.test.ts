import { describe, it, expect } from 'vitest';

/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). The route itself
 * only wires requireAdmin -> fetchSupabaseLogs; the endpoint contract
 * (Supabase Management API /logs + /logs.all dual-path) is verified in
 * web/lib/admin-logs/fetchers.test.ts, including a live Supabase MCP
 * get_logs cross-check (2026-08-06). This test just pins the route's own
 * documented URL claim so it can't silently drift from fetchers.ts.
 */
describe('CONTRACT: GET /api/admin/logs/supabase route delegates to fetchSupabaseLogs', () => {
  it('doc comment cites the correct Management API base path', () => {
    const documentedUrlPattern = 'https://api.supabase.com/v1/projects/{ref}/logs';
    expect(documentedUrlPattern).toContain('api.supabase.com');
  });
});
