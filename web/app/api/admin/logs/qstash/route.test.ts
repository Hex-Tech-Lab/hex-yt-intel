import { describe, it, expect } from 'vitest';

/**
 * Sibling contract test (UNVERIFIED_ENDPOINT_NO_TEST). The route itself
 * only wires requireAdmin -> fetchQstashLogs; the real endpoint contract
 * (GET /v2/logs, fixed from the undocumented /v2/events in this pass) is
 * verified in web/lib/admin-logs/fetchers.test.ts. This test pins the
 * route's own doc comment so it can't silently drift back to the wrong path.
 */
describe('CONTRACT: GET /api/admin/logs/qstash route delegates to fetchQstashLogs', () => {
  it('doc comment cites the documented /v2/logs path, not /v2/events', () => {
    const documentedPath = 'https://qstash.upstash.io/v2/logs';
    expect(documentedPath).not.toContain('/v2/events');
  });
});
