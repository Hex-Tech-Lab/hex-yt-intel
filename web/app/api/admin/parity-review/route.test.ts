/**
 * docs/research/ was untracked on 2026-10-11 (PR #462); the parity dump now
 * lives in the git-ignored private companion checkout. The route must read
 * docs/private/research first and only fall back to the legacy path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireAdminMock = vi.fn();
const readFileMock = vi.fn();
const captureExceptionMock = vi.fn();
const captureMessageMock = vi.fn();

vi.mock('@/lib/utils/require-admin', () => ({ requireAdmin: requireAdminMock }));
vi.mock('node:fs/promises', () => ({ readFile: readFileMock }));
vi.mock('@sentry/nextjs', () => ({ captureException: captureExceptionMock, captureMessage: captureMessageMock, addBreadcrumb: vi.fn() }));

const VALID = JSON.stringify({ videos: [{ video_id: 'v1', dimensions: {} }] });
const enoent = () => Object.assign(new Error('missing'), { code: 'ENOENT' });

describe('GET /api/admin/parity-review', () => {
  beforeEach(() => {
    requireAdminMock.mockReset().mockResolvedValue({ ok: true, userId: 'admin-1' });
    readFileMock.mockReset();
    captureExceptionMock.mockReset();
    captureMessageMock.mockReset();
  });

  it('reads the private research copy first', async () => {
    readFileMock.mockResolvedValueOnce(VALID);
    const { GET } = await import('./route');

    const body = await (await GET()).json();

    expect(body.available).toBe(true);
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(String(readFileMock.mock.calls[0][0])).toMatch(/docs[\\/]private[\\/]research[\\/]2026-08-18-parity-batch-results\.json$/);
  });

  it('falls back to the legacy docs/research path when the private copy is absent', async () => {
    readFileMock.mockRejectedValueOnce(enoent()).mockResolvedValueOnce(VALID);
    const { GET } = await import('./route');

    const body = await (await GET()).json();

    expect(body.available).toBe(true);
    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(String(readFileMock.mock.calls[1][0])).toMatch(/docs[\\/]research[\\/]2026-08-18-parity-batch-results\.json$/);
  });

  it('returns available:false when neither copy exists', async () => {
    readFileMock.mockRejectedValue(enoent());
    const { GET } = await import('./route');

    const body = await (await GET()).json();

    expect(body).toEqual({ available: false, reason: 'not_generated_yet' });
  });

  it('does not mask a non-ENOENT read error as missing', async () => {
    readFileMock.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const { GET } = await import('./route');

    const res = await GET();

    expect(res.status).toBe(500);
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).toBe('Failed to read parity batch results');
  });

  it('refuses non-admins without reading any file', async () => {
    requireAdminMock.mockResolvedValueOnce({ ok: false, status: 403, error: 'Forbidden' });
    const { GET } = await import('./route');

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it('returns 500 and reports to Sentry when the file fails schema validation', async () => {
    readFileMock.mockResolvedValueOnce(JSON.stringify({ videos: [{ dimensions: {} }] }));
    const { GET } = await import('./route');

    const res = await GET();

    expect(res.status).toBe(500);
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('returns the fixed 500 message for malformed JSON', async () => {
    readFileMock.mockResolvedValueOnce('{not json');
    const { GET } = await import('./route');

    const res = await GET();

    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Failed to read parity batch results');
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });
});
