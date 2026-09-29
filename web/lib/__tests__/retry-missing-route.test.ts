/**
 * Route contract for POST /api/analyses/[id]/retry (#367 review): auth before
 * body parsing, malformed JSON rejected (never widened into a full retry),
 * empty body = omitted dimensions, and outcome -> HTTP status mapping.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticate = vi.fn();
const runRetryWithDefaultDeps = vi.fn();

vi.mock('@/lib/adapters/SupabaseAuthAdapter', () => ({
  SupabaseAuthAdapter: class { authenticate = authenticate; },
}));
vi.mock('@/lib/usecases/RetryMissingDimensionsUseCase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/usecases/RetryMissingDimensionsUseCase')>();
  return { ...actual, runRetryWithDefaultDeps };
});
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const call = async (body?: string) => {
  const { POST } = await import('@/app/api/analyses/[id]/retry/route');
  const request = new NextRequest('http://localhost/api/analyses/a-1/retry', { method: 'POST', body });
  return POST(request, { params: Promise.resolve({ id: 'a-1' }) });
};

describe('POST /api/analyses/[id]/retry — HTTP contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue({ userId: 'u-1' });
    runRetryWithDefaultDeps.mockResolvedValue({ type: 'nothing_missing' });
  });

  it('401 for unauthenticated callers, whether the body is valid or malformed', async () => {
    authenticate.mockResolvedValue(null);
    expect((await call('{"missingDimensions":[3]}')).status).toBe(401);
    expect((await call('{not json')).status).toBe(401);
    expect(runRetryWithDefaultDeps).not.toHaveBeenCalled();
  });

  it('400 for malformed JSON (not widened into a retry of everything)', async () => {
    const response = await call('{not json');
    expect(response.status).toBe(400);
    expect(runRetryWithDefaultDeps).not.toHaveBeenCalled();
  });

  it('empty body = omitted dimensions; explicit [] is passed through as []', async () => {
    await call('');
    expect(runRetryWithDefaultDeps).toHaveBeenLastCalledWith(expect.objectContaining({ requestedDimensions: undefined }));
    await call('{"missingDimensions":[]}');
    expect(runRetryWithDefaultDeps).toHaveBeenLastCalledWith(expect.objectContaining({ requestedDimensions: [] }));
  });

  it('maps use-case outcomes to HTTP statuses', async () => {
    const cases: Array<[unknown, number]> = [
      [{ type: 'error', message: 'not_found_or_forbidden' }, 404],
      [{ type: 'in_progress' }, 409],
      [{ type: 'retry_in_progress' }, 409],
      [{ type: 'ineligible' }, 409],
      [{ type: 'budget_exhausted' }, 429],
      [{ type: 'disabled' }, 503],
      [{ type: 'nothing_missing' }, 200],
      [{ type: 'ok', status: 'remediated', dimensionsRequested: [3], dimensionCountAfter: 3 }, 200],
    ];
    for (const [outcome, status] of cases) {
      runRetryWithDefaultDeps.mockResolvedValueOnce(outcome);
      expect((await call('{}')).status).toBe(status);
    }
  });
});
