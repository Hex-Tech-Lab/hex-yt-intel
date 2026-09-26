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
    // Strengthened assertion (real finding 2026-08-20, automated PR review):
    // `status !== 401` alone would also pass for a redirect or 500, neither
    // of which is the real exemption contract. NextResponse.next() -- the
    // only way this middleware "lets a request through" -- is specifically
    // a 200 carrying the x-middleware-next header, so assert both.
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
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

  // Live-caught 2026-09-23 (CF Worker logs: "Chapter persist returned non-2xx"
  // on every analyze stream, video 4mTLpuQpB80): the worker's cookie-less S2S
  // POST to /api/videos/[videoId]/chapters 401'd at this middleware gate
  // ({"error":"Unauthorized"}) because the fail-closed allowlist never listed
  // the route -- the route's own HMAC gate (verifyContentSig, purpose
  // 'chapters') never ran. Same bug class as /api/waitlist (2026-08-14) and
  // /api/test-auth (2026-08-20). Shipped broken 2026-08-06 (PR #206).
  it('exempts the worker S2S POST to /api/videos/[videoId]/chapters from the session gate', async () => {
    const req = new NextRequest('https://getvintel.com/api/videos/4mTLpuQpB80/chapters', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('does NOT exempt a non-videoId child path that merely ends in /chapters', async () => {
    // Traversal-ish shape: the segment-boundary regex must not let
    // /api/videos/../../x/chapters or multi-segment ids through.
    const req = new NextRequest('https://getvintel.com/api/videos/a/b/chapters', { method: 'POST' });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });

  it('does NOT exempt the sibling GET on /api/videos/[videoId]/chapters (browser-session read)', async () => {
    const req = new NextRequest('https://getvintel.com/api/videos/4mTLpuQpB80/chapters', { method: 'GET' });
    const res = await middleware(req);
    expect(res.status).toBe(401);
  });
});
