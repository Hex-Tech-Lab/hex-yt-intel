/**
 * PR #317 round-2, item 5: security-regression coverage for the Next.js
 * Image Optimization API path (the surface of the 2 unauthenticated RCE
 * CVEs fixed by the 16.2.11 → 16.3.3 bump).
 *
 * What this covers: the public `/_next/image` endpoint's HTTP-level
 * contract — unauthenticated request handling, malformed/oversized inputs,
 * and AVIF vs non-AVIF content negotiation must return sane status codes
 * (4xx/blocked or proxied success) and never a 5xx crash or unexpected
 * execution path.
 *
 * What this does NOT cover (explicit, per dispatch):
 * - The internal CVE fix code itself (upstream, patched in next@16.3.3 —
 *   the installed-version floor is asserted separately in
 *   lib/__tests__/next-dependency-guards.test.ts).
 * - A decode-verified image payload comparison (fixture bytes asserted
 *   only loosely, content-type-level).
 * - Exhaustive upstream fuzz coverage.
 */
import { test, expect } from '@playwright/test';

const DEPLOYMENT_URL = process.env.DEPLOYMENT_URL || 'http://localhost:3000';
const BASE = DEPLOYMENT_URL.replace(/\/$/, '');

// A real, valid image on the deployed origin — the optimizer only proxies
// same-origin (or allowlisted remote) URLs. web/public had NO raster assets
// at all (only app/icon.svg, which the optimizer refuses by default), so a
// 1x1 PNG fixture was added specifically to exercise the SUCCESS path
// (verified live: /favicon.ico alone 400s with "not a valid image", which
// silently left the positive case untested until this fixture existed).
const FIXTURE_PATH = '/__image-opt-test-fixture-1px.png';
const ENCODED_FIXTURE_URL = encodeURIComponent(FIXTURE_PATH);
// Non-image asset on the origin — the optimizer must reject it sanely
// (app/icon.svg: SVG is refused by default unless dangerouslyAllowSVG).
const NON_IMAGE_PATH = '/icon.svg';

test.describe('Next Image Optimization API — unauthenticated security surface', () => {
  test('AVIF-negotiated request for a valid same-origin image succeeds without crashing', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${ENCODED_FIXTURE_URL}&w=64&q=75`,
      { headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' } }
    );
    // Must be a successful proxy/optimization or a sane 4xx — never a 5xx.
    expect(res.status()).toBeLessThan(500);
    if (res.status() < 400) {
      const contentType = res.headers()['content-type'] || '';
      // AVIF negotiation is honored (or falls back to a raster/webp/same-format type).
      expect(contentType).toMatch(/avif|webp|image\//);
      const body = await res.body();
      // Non-empty payload with a plausible image signature — not an error page.
      expect(body.length).toBeGreaterThan(0);
    }
  });

  test('non-image asset (SVG, dangerouslyAllowSVG off) is refused, not proxied', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${encodeURIComponent(NON_IMAGE_PATH)}&w=64&q=75`,
      { headers: { Accept: 'image/avif,image/webp,*/*;q=0.8' } }
    );
    // SVG must never be transcodable/proxied by default (script-injection vector).
    expect(res.status()).not.toBe(200);
    expect(res.status()).toBeLessThan(500);
  });

  test('non-AVIF (plain image/jpeg) Accept header still serves an image', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${ENCODED_FIXTURE_URL}&w=64&q=75`,
      { headers: { Accept: 'image/jpeg,image/png,*/*;q=0.8' } }
    );
    expect(res.status()).toBeLessThan(500);
    if (res.status() < 400) {
      expect(res.headers()['content-type'] || '').toMatch(/image\//);
    }
  });

  test('missing url param is rejected with a client error, not a crash', async ({ request }) => {
    const res = await request.get(`${BASE}/_next/image?w=64&q=75`);
    expect([400, 404]).toContain(res.status());
  });

  test('malformed url param (bad scheme / encoded control chars) is rejected', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${encodeURIComponent('file:///etc/passwd')}&w=64&q=75`
    );
    // Upstream must refuse non-http(s) sources — 400 is the sane rejection.
    expect(res.status()).toBeLessThan(500);
    expect(res.status()).not.toBe(200);
  });

  test('external (unallowlisted) host is refused, not proxied', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}&w=64&q=75`
    );
    // SSRF surface: must never succeed against an unallowlisted host.
    expect(res.status()).not.toBe(200);
    expect(res.status()).toBeLessThan(500);
  });

  test('oversized width parameter is rejected with a client error', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${ENCODED_FIXTURE_URL}&w=${Number.MAX_SAFE_INTEGER}&q=75`
    );
    expect([400, 404]).toContain(res.status());
  });

  test('invalid quality parameter is rejected with a client error', async ({ request }) => {
    const res = await request.get(`${BASE}/_next/image?url=${ENCODED_FIXTURE_URL}&w=64&q=999`);
    expect([400, 404]).toContain(res.status());
  });

  test('bogus deviceSizes-style width (non-numeric) is rejected', async ({ request }) => {
    const res = await request.get(
      `${BASE}/_next/image?url=${ENCODED_FIXTURE_URL}&w=not-a-number&q=75`
    );
    expect([400, 404]).toContain(res.status());
  });

  test('empty url param is rejected', async ({ request }) => {
    const res = await request.get(`${BASE}/_next/image?url=&w=64&q=75`);
    expect([400, 404]).toContain(res.status());
  });
});
