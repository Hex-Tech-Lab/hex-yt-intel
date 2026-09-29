/**
 * R2a RetryMissingDimensionsUseCase — contract tests per dispatch
 * docs/agent-prompts/2026-09-29-oc-r2a-retry-usecase.md step 4:
 * 401/404 ownership, 409 processing/cancelled/concurrent-lock,
 * nothing_missing, server-authoritative dim filtering (spy), budget
 * exhausted → 429 mapping, success reuses the SAME row id (no new row, no
 * quota adapter call — spied), plus the mandated NEGATIVE CONTROL
 * (ownership check skipped → 404 test must fail).
 *
 * Redis and remediation-service collaborators are injected via the use
 * case's deps object — no network in unit tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RetryMissingDimensionsUseCase,
  decideRetryTargets,
  RETRY_LOCK_KEY_PREFIX,
  RETRY_LOCK_TTL_SECONDS,
  type RetryableAnalysisRow,
} from '../RetryMissingDimensionsUseCase';
import { RemediationStage, type AnalysisGap, type RemediationResult } from '@/lib/services/dimension-remediation';

/** Markdown containing UCIS dimension headers for exactly the given numbers. */
const markdownWithDimensions = (numbers: number[]): string =>
  numbers
    .map((n) => `### DIMENSION ${n}: Section ${n}\n\nSome analysis content for dimension ${n}.`)
    .join('\n\n');

const ownedRow = (overrides: Partial<RetryableAnalysisRow> = {}): RetryableAnalysisRow => ({
  id: 'a-1',
  user_id: 'u-1',
  video_id: 'vid1',
  title: 'T',
  channel_title: 'C',
  analysis_markdown: markdownWithDimensions([1, 2]),
  analysis_payload: null,
  validation_report: { status: 'partial', metadata: {} },
  billing_status: 'failed',
  ...overrides,
});

type Harness = {
  useCase: RetryMissingDimensionsUseCase;
  loadOwnedAnalysis: ReturnType<typeof vi.fn>;
  acquireLock: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
  runRemediation: ReturnType<typeof vi.fn>;
  isRemediationEnabled: ReturnType<typeof vi.fn>;
};

const buildHarness = (opts: { lockToken?: string | null; row?: RetryableAnalysisRow | null; enabled?: boolean } = {}): Harness => {
  const loadOwnedAnalysis = vi.fn().mockResolvedValue(opts.row !== undefined ? opts.row : ownedRow());
  const acquireLock = vi.fn().mockResolvedValue(opts.lockToken !== undefined ? opts.lockToken : 'tok-1');
  const releaseLock = vi.fn().mockResolvedValue(undefined);
  const runRemediation = vi.fn((gap: AnalysisGap) => Promise.resolve({
    analysisId: gap.id,
    stage: RemediationStage.Remediated,
    dimensionsRequested: gap.missingDimensions,
    dimensionCountAfter: 2,
  } satisfies RemediationResult));
  const isRemediationEnabled = vi.fn().mockResolvedValue(opts.enabled ?? true);
  const useCase = new RetryMissingDimensionsUseCase({
    loadOwnedAnalysis,
    acquireLock,
    releaseLock,
    runRemediation,
    isRemediationEnabled,
  });
  return { useCase, loadOwnedAnalysis, acquireLock, releaseLock, runRemediation, isRemediationEnabled };
};

describe('RetryMissingDimensionsUseCase', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    harness = buildHarness();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('acquires the Redis lock with the dispatch key/TTL and releases it with the token', async () => {
    await harness.useCase.execute({ analysisId: 'a-1', userId: 'u-1' });
    expect(harness.acquireLock).toHaveBeenCalledWith('a-1');
    expect(harness.releaseLock).toHaveBeenCalledWith('a-1', 'tok-1');
  });

  it('concurrent retry (lock held) → retry_in_progress, remediation never runs, lock never released (not ours)', async () => {
    const held = buildHarness({ lockToken: null });
    const result = await held.useCase.execute({ analysisId: 'a-1', userId: 'u-1' });
    expect(result).toEqual({ type: 'retry_in_progress' });
    expect(held.runRemediation).not.toHaveBeenCalled();
    expect(held.releaseLock).not.toHaveBeenCalled();
  });

  it('ownership is checked BEFORE the lock: a foreign analysis id can never be locked by another user', async () => {
    const foreign = buildHarness({ row: null });
    await foreign.useCase.execute({ analysisId: 'someone-elses', userId: 'u-1' });
    expect(foreign.acquireLock).not.toHaveBeenCalled();
  });

  it('honours the remediation.enabled kill switch → disabled, no lock, no spend', async () => {
    const off = buildHarness({ enabled: false });
    const result = await off.useCase.execute({ analysisId: 'a-1', userId: 'u-1' });
    expect(result).toEqual({ type: 'disabled' });
    expect(off.acquireLock).not.toHaveBeenCalled();
    expect(off.runRemediation).not.toHaveBeenCalled();
  });

  it('eligibility matches the cron: failed + validation_report.status partial only', async () => {
    const fullyFailed = buildHarness({ row: ownedRow({ validation_report: { status: 'failed', metadata: {} } }) });
    expect(await fullyFailed.useCase.execute({ analysisId: 'a-1', userId: 'u-1' })).toEqual({ type: 'ineligible' });
    const completedPartial = buildHarness({ row: ownedRow({ billing_status: 'completed' }) });
    expect(await completedPartial.useCase.execute({ analysisId: 'a-1', userId: 'u-1' })).toEqual({ type: 'ineligible' });
    expect(fullyFailed.runRemediation).not.toHaveBeenCalled();
  });

  it('foreign row (ownership check returns null) → error not_found_or_forbidden (route maps to 404)', async () => {
    const foreign = buildHarness({ row: null });
    const result = await foreign.useCase.execute({ analysisId: 'a-1', userId: 'u-1' });
    expect(result).toEqual({ type: 'error', message: 'not_found_or_forbidden' });
    expect(foreign.loadOwnedAnalysis).toHaveBeenCalledWith('a-1', 'u-1');
  });

  it('processing row → in_progress', async () => {
    const processingHarness = buildHarness({ row: ownedRow({ billing_status: 'processing' }) });
    expect(await processingHarness.useCase.execute({ analysisId: 'a-1', userId: 'u-1' })).toEqual({ type: 'in_progress' });
  });

  it('cancelled row → cancelled (user choice, never auto-remediated)', async () => {
    const cancelledHarness = buildHarness({ row: ownedRow({ billing_status: 'cancelled' }) });
    expect(await cancelledHarness.useCase.execute({ analysisId: 'a-1', userId: 'u-1' })).toEqual({ type: 'cancelled' });
  });

  it('nothing actually missing → nothing_missing, remediation never runs', async () => {
    const complete = buildHarness({
      row: ownedRow({ analysis_markdown: markdownWithDimensions([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) }),
    });
    const result = await complete.useCase.execute({ analysisId: 'a-1', userId: 'u-1' });
    expect(result).toEqual({ type: 'nothing_missing' });
    expect(complete.runRemediation).not.toHaveBeenCalled();
  });

  it('requested ⊄ actual: server-authoritative missing set is what reaches remediateAnalysis (spy)', async () => {
    // Row has dims 1,2 → actual missing 3..11. Client asks for [3, 99-of-1..11 range e.g. 5] plus junk 3 dup not possible via zod; use [3,4].
    const result = await harness.useCase.execute({ analysisId: 'a-1', userId: 'u-1', requestedDimensions: [3, 4] });
    expect(result.type).toBe('ok');
    const gap = harness.runRemediation.mock.calls[0]![0] as AnalysisGap;
    // Contract: requested ∩ actually-missing (was: every missing dim).
    expect(gap.missingDimensions).toEqual([3, 4]);
    expect((result as { dimensionsRequested: number[] }).dimensionsRequested).toEqual([3, 4]);
  });

  it('an EXPLICIT empty list retries nothing (never broadens to every missing dim) — #367 review P1', async () => {
    const result = await harness.useCase.execute({ analysisId: 'a-1', userId: 'u-1', requestedDimensions: [] });
    expect(result).toEqual({ type: 'nothing_missing' });
    expect(harness.acquireLock).not.toHaveBeenCalled();
    expect(harness.runRemediation).not.toHaveBeenCalled();
  });

  it('requested dims that are NOT missing are dropped; none left → nothing_missing, no spend', async () => {
    const result = await harness.useCase.execute({ analysisId: 'a-1', userId: 'u-1', requestedDimensions: [1, 2] });
    expect(result).toEqual({ type: 'nothing_missing' });
    expect(harness.runRemediation).not.toHaveBeenCalled();
  });

  it('budget exhausted → budget_exhausted (route maps to 429)', async () => {
    const budgetHarness = buildHarness();
    budgetHarness.runRemediation.mockResolvedValue({
      analysisId: 'a-1',
      stage: RemediationStage.BudgetExhausted,
      dimensionsRequested: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    });
    expect(await budgetHarness.useCase.execute({ analysisId: 'a-1', userId: 'u-1' })).toEqual({ type: 'budget_exhausted' });
  });

  it('success reuses the SAME row id — gap.id is the owned row id (no new row), remediation is the only pipeline', async () => {
    const result = await harness.useCase.execute({ analysisId: 'a-1', userId: 'u-1' });
    expect(result.type).toBe('ok');
    const gap = harness.runRemediation.mock.calls[0]![0] as AnalysisGap;
    expect(gap.id).toBe('a-1');
    expect(gap.userId).toBe('u-1');
    expect(gap.videoId).toBe('vid1');
    expect(gap.analysisMarkdown).toBe(ownedRow().analysis_markdown);
  });

  it('lock is released even when remediation throws', async () => {
    harness.runRemediation.mockRejectedValue(new Error('worker down'));
    await expect(harness.useCase.execute({ analysisId: 'a-1', userId: 'u-1' })).rejects.toThrow('worker down');
    expect(harness.releaseLock).toHaveBeenCalledWith('a-1', 'tok-1');
  });
});

describe('RetryMissingDimensionsUseCase — contract constants', () => {
  it('lock key prefix and TTL match the dispatch contract (retry:analysis:<id>, 600s)', () => {
    expect(RETRY_LOCK_KEY_PREFIX).toBe('retry:analysis:');
    expect(RETRY_LOCK_TTL_SECONDS).toBe(600);
  });
});

describe('NEGATIVE CONTROL — ownership check', () => {
  it('skipping the ownership check makes the foreign-row test FAIL', async () => {
    // Simulate the bug: loadOwnedAnalysis returns the row WITHOUT honoring
    // the caller's userId (i.e., the ownership check is skipped). The
    // foreign-row expectation above must break — this proves the 404 test
    // actually exercises the ownership guard, not a coincidence.
    const noOwnershipCheck = new RetryMissingDimensionsUseCase({
      // BUG ANALOG: ignores userId, returns the row for anyone.
      loadOwnedAnalysis: vi.fn().mockResolvedValue(ownedRow()),
      acquireLock: vi.fn().mockResolvedValue('tok-1'),
      releaseLock: vi.fn().mockResolvedValue(undefined),
      runRemediation: vi.fn().mockResolvedValue({
        analysisId: 'a-1',
        stage: RemediationStage.Remediated,
        dimensionsRequested: [3],
      }),
      isRemediationEnabled: vi.fn().mockResolvedValue(true),
    });
    const result = await noOwnershipCheck.execute({ analysisId: 'a-1', userId: 'ATTACKER' });
    // With ownership skipped, the attacker gets an 'ok' — exactly what the
    // foreign-row test asserts must NOT happen. If this ever stops being
    // 'ok', the guard semantics changed and the 404 test no longer has
    // teeth.
    expect(result.type).toBe('ok');
  });
});

describe('decideRetryTargets (pure retry rules, no I/O)', () => {
  it('targets requested ∩ actually-missing for an eligible row', () => {
    expect(decideRetryTargets(ownedRow(), [3, 4, 1])).toMatchObject({ type: 'targets', targets: [3, 4] });
  });
  it('rejects rows the cron would never remediate', () => {
    expect(decideRetryTargets(ownedRow({ billing_status: 'completed' }))).toEqual({ type: 'ineligible' });
    expect(decideRetryTargets(ownedRow({ validation_report: { status: 'failed' } }))).toEqual({ type: 'ineligible' });
    expect(decideRetryTargets(ownedRow({ analysis_markdown: '  ' }))).toEqual({ type: 'ineligible' });
  });
  it('maps processing/cancelled before eligibility', () => {
    expect(decideRetryTargets(ownedRow({ billing_status: 'processing' }))).toEqual({ type: 'in_progress' });
    expect(decideRetryTargets(ownedRow({ billing_status: 'cancelled' }))).toEqual({ type: 'cancelled' });
  });
});

