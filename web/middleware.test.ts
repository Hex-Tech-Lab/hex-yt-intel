import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';

/**
 * Real regression contract test (2026-08-20, automated PR review P1):
 * the middleware-to-route auth contract for /api/test-auth/login had no
 * test connecting it, which is exactly the class of gap that let the route
 * ship correctly gated internally while still 401'ing at the middleware
 * layer in production for days. Also covers the exact-match fix for that
 * route (no child-path inheritance) and confirms an ordinary protected
 * route is unaffected.
 */
describe('middleware public-route allowlist', () => {
  it('exempts /api/test-auth/login (exact) from the session gate', async () => {
    const req = new NextRequest('https://getvintel.com/api/test-auth/login', { method: 'POST' });
    const res = await middleware(req);
    // NextResponse.next() carries the x-middleware-next header and is NOT
    // a 401 JSON response -- the real proof this path skips the auth gate.
    expect(res.status).not.toBe(401);
    const body = await res.text().catch(() => '');
    expect(body).not.toContain('Unauthorized');
  });

  it('does NOT exempt a hypothetical child path under /api/test-auth/login', async () => {
    const req = new NextRequest('https://getvintel.com/api/test-auth/login/child', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('still fail-closes an ordinary protected /api/* route with no session', async () => {
    const req = new NextRequest('https://getvintel.com/api/admin/logs', { method: 'GET' });
    const res = await middleware(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: 'Unauthorized' });
  });
});
