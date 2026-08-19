import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mocks -----------------------------------------------------------------
// Mirrors the real shapes returned by supabase-js's admin.generateLink and
// @supabase/ssr's createServerClient, so the test proves the route's own
// gating/cookie-writing logic without hitting a real Supabase project.

const generateLinkMock = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { admin: { generateLink: generateLinkMock } },
  }),
}));

const verifyOtpMock = vi.fn();
let capturedSetAll: ((cookies: { name: string; value: string; options?: Record<string, unknown> }[]) => void) | null = null;
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: typeof capturedSetAll } }) => {
    capturedSetAll = opts.cookies.setAll as never;
    return { auth: { verifyOtp: verifyOtpMock } };
  },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ getAll: () => [] }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const ORIGINAL_ENV = { ...process.env };

function makeRequest(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/test-auth/login', {
    method: 'POST',
    headers,
  });
}

describe('POST /api/test-auth/login', () => {
  beforeEach(() => {
    vi.resetModules();
    generateLinkMock.mockReset();
    verifyOtpMock.mockReset();
    capturedSetAll = null;
    process.env = { ...ORIGINAL_ENV };
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://adnmbikaqnxivalqoild.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('is fully inert (404) when TEST_AUTH_BYPASS_SECRET is not configured — the production default', async () => {
    delete process.env.TEST_AUTH_BYPASS_SECRET;
    const { POST } = await import('./route');

    const res = await POST(makeRequest({ 'x-test-auth-secret': 'anything' }));

    expect(res.status).toBe(404);
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it('404s when the env var is set but the request secret does not match', async () => {
    process.env.TEST_AUTH_BYPASS_SECRET = 'correct-secret';
    const { POST } = await import('./route');

    const res = await POST(makeRequest({ 'x-test-auth-secret': 'wrong-secret' }));

    expect(res.status).toBe(404);
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it('404s when no secret header is provided at all, even with the env var configured', async () => {
    process.env.TEST_AUTH_BYPASS_SECRET = 'correct-secret';
    const { POST } = await import('./route');

    const res = await POST(makeRequest());

    expect(res.status).toBe(404);
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it('mints a real session for the hardcoded test account and writes real Supabase session cookies when both gates pass', async () => {
    process.env.TEST_AUTH_BYPASS_SECRET = 'correct-secret';
    generateLinkMock.mockResolvedValue({
      data: { properties: { hashed_token: 'real-hashed-token' } },
      error: null,
    });
    verifyOtpMock.mockImplementation(async () => {
      // Simulate @supabase/ssr writing the real sb-* session cookies via
      // setAll, exactly as the live callback route's flow does.
      capturedSetAll?.([
        { name: 'sb-adnmbikaqnxivalqoild-auth-token', value: 'real-session-jwt-payload', options: { path: '/', httpOnly: false } },
      ]);
      return { error: null };
    });

    const { POST } = await import('./route');
    const res = await POST(makeRequest({ 'x-test-auth-secret': 'correct-secret' }));

    expect(res.status).toBe(200);
    // Only ever the one hardcoded test account -- never an attacker-supplied email.
    expect(generateLinkMock).toHaveBeenCalledWith({
      type: 'magiclink',
      email: 'testSprite@getvintel.com',
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({
      type: 'magiclink',
      token_hash: 'real-hashed-token',
    });

    // Real cookie inspection: the session cookie Supabase's own SSR client
    // wrote must actually be present on the response.
    const sessionCookie = res.cookies.get('sb-adnmbikaqnxivalqoild-auth-token');
    expect(sessionCookie?.value).toBe('real-session-jwt-payload');
  });
});
