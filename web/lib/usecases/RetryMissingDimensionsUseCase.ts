import { z } from 'zod';

import {
  RemediationStage,
  remediateAnalysis,
  computeMissingDimensions,
  resolveBudgetParams,
  cheapestCostPer1K,
  REMEDIATION_ROW_LOCK_KEY_PREFIX,
  REMEDIATION_ROW_LOCK_TTL_SECONDS,
  type AnalysisGap,
  type RemediationResult,
} from '@/lib/services/dimension-remediation';
import { resolveAnalysisCascade } from '@/lib/config/cascade';
import { acquireRedisLock, releaseRedisLock } from '@/lib/redis';

/**
 * R2a (audit finding 1): server-side per-analysis retry for rows missing
 * dimensions. REUSES the exact remediation pipeline the 5-minute cron uses
 * (remediateAnalysis + resolveAnalysisCascade + resolveBudgetParams) — no
 * second retry pipeline, no new row, no quota reservation.
 *
 * Dispatch: docs/agent-prompts/2026-09-29-oc-r2a-retry-usecase.md.
 */

/** Zod contract for the request body: optional requested dimension subset. */
export const RetryMissingDimensionsSchema = z.object({
  missingDimensions: z
    .array(z.number().int().min(1).max(11))
    .max(11)
    .optional(),
});

/** Redis lock prefix for in-flight retries; value = lock token. 10 min TTL. */
/** Same lock the cron takes (dimension-remediation.ts), so cron and owner retry never race on a row. */
export const RETRY_LOCK_KEY_PREFIX = REMEDIATION_ROW_LOCK_KEY_PREFIX;
export const RETRY_LOCK_TTL_SECONDS = REMEDIATION_ROW_LOCK_TTL_SECONDS;

export type RetryOutcome =
  | { type: 'nothing_missing' }
  | { type: 'in_progress' }
  | { type: 'cancelled' }
  | { type: 'ineligible' }
  | { type: 'retry_in_progress' }
  | { type: 'budget_exhausted' }
  | { type: 'disabled' }
  | {
      type: 'ok';
      status: RemediationStage;
      dimensionsRequested: number[];
      dimensionCountAfter?: number;
    }
  | { type: 'error'; message: string };

/** Row shape the ownership check selects. */
export interface RetryableAnalysisRow {
  id: string;
  user_id: string;
  video_id: string;
  title: string | null;
  channel_title: string | null;
  analysis_markdown: string | null;
  analysis_payload: Record<string, unknown> | null;
  validation_report: unknown;
  billing_status: string;
}

/**
 * Same population the cron remediates (dimension-remediation.ts
 * findAnalysesWithMissingDimensions): failed rows with real partial content.
 * 'cancelled' is a user choice (ADR 020) — never auto-remediated, 409 here.
 */



/**
 * Pure retry rules (no I/O): status gates, the cron's eligibility
 * (billing 'failed' + validation_report.status 'partial'; fully failed rows
 * are never remediated), and requested ∩ actually-missing targeting.
 */
export function decideRetryTargets(
  row: RetryableAnalysisRow,
  requestedDimensions?: number[]
): { type: 'targets'; targets: number[]; markdown: string } | { type: 'in_progress' } | { type: 'cancelled' } | { type: 'ineligible' } | { type: 'nothing_missing' } {
  if (row.billing_status === 'processing') return { type: 'in_progress' };
  if (row.billing_status === 'cancelled') return { type: 'cancelled' };
  const status = (row.validation_report as { status?: unknown } | null)?.status;
  if (row.billing_status !== 'failed' || status !== 'partial') return { type: 'ineligible' };
  const markdown = row.analysis_markdown ?? '';
  if (!markdown.trim()) return { type: 'ineligible' };
  const actualMissing = computeMissingDimensions(markdown);
  // Omitted = every actually-missing dimension; an EXPLICIT empty list means
  // "retry nothing" (#367 review P1: it used to broaden to everything).
  const targets = requestedDimensions === undefined
    ? actualMissing
    : actualMissing.filter((dim) => requestedDimensions.includes(dim));
  return targets.length === 0 ? { type: 'nothing_missing' } : { type: 'targets', targets, markdown };
}

export class RetryMissingDimensionsUseCase {
  constructor(
    private deps: {
      loadOwnedAnalysis: (analysisId: string, userId: string) => Promise<RetryableAnalysisRow | null>;
      acquireLock: (analysisId: string) => Promise<string | null>;
      releaseLock: (analysisId: string, token: string) => Promise<void>;
      runRemediation: (gap: AnalysisGap) => Promise<RemediationResult>;
      /** Same kill switch the cron honours (registry remediation.enabled). */
      isRemediationEnabled: () => Promise<boolean>;
    }
  ) {}

  async execute(params: {
    analysisId: string;
    userId: string;
    requestedDimensions?: number[];
  }): Promise<RetryOutcome> {
    const { analysisId, userId } = params;
    // Ownership FIRST (CC review): taking the lock before this let any
    // signed-in user lock someone else's analysis id and block its owner.
    const row = await this.deps.loadOwnedAnalysis(analysisId, userId);
    if (!row) return { type: 'error', message: 'not_found_or_forbidden' };
    const decision = decideRetryTargets(row, params.requestedDimensions);
    if (decision.type !== 'targets') return decision;
    const { targets, markdown } = decision;

    if (!(await this.deps.isRemediationEnabled())) return { type: 'disabled' };

    const lockToken = await this.deps.acquireLock(analysisId);
    if (!lockToken) return { type: 'retry_in_progress' };
    try {
      const report = row.validation_report as Record<string, unknown> | null;
      const reportObj = report && typeof report === 'object' && !Array.isArray(report) ? report : {};
      const reportMetadata = reportObj.metadata as Record<string, unknown> | undefined;

      const gap: AnalysisGap = {
        id: row.id,
        userId: row.user_id,
        videoId: row.video_id,
        title: row.title ?? '',
        channelTitle: row.channel_title ?? '',
        metadata: reportMetadata ?? {},
        analysisMarkdown: markdown,
        analysisPayload: row.analysis_payload,
        validationReport: row.validation_report,
        missingDimensions: targets,
      };

      const outcome = await this.deps.runRemediation(gap);
      if (outcome.stage === RemediationStage.BudgetExhausted) return { type: 'budget_exhausted' };

      return {
        type: 'ok',
        status: outcome.stage,
        dimensionsRequested: outcome.dimensionsRequested,
        dimensionCountAfter: outcome.dimensionCountAfter,
      };
    } finally {
      await this.deps.releaseLock(analysisId, lockToken);
    }
  }
}

/**
 * Production wiring: ownership via the existing Supabase adapter, the SAME
 * models/cascade/budget resolution runRemediationHarness uses (resolved once
 * per request, mirroring the cron's once-per-run), and the Redis retry lock.
 */
export async function runRetryWithDefaultDeps(params: {
  analysisId: string;
  userId: string;
  requestedDimensions?: number[];
  loadOwnedAnalysis: RetryMissingDimensionsUseCase['deps']['loadOwnedAnalysis'];
}): Promise<RetryOutcome> {
  // One budget/kill-switch snapshot per retry (#367 review): the enabled check
  // and the spend must see the same configuration, with one settings read.
  let budgetPromise: ReturnType<typeof resolveBudgetParams> | undefined;
  const budgetSnapshot = () => (budgetPromise ??= resolveBudgetParams());

  const useCase = new RetryMissingDimensionsUseCase({
    loadOwnedAnalysis: params.loadOwnedAnalysis,
    acquireLock: (id) => acquireRedisLock(`${RETRY_LOCK_KEY_PREFIX}${id}`, RETRY_LOCK_TTL_SECONDS),
    releaseLock: (id, token) => releaseRedisLock(`${RETRY_LOCK_KEY_PREFIX}${id}`, token),
    isRemediationEnabled: async () => (await budgetSnapshot()).enabled,
    runRemediation: async (gap) => {
      const budget = await budgetSnapshot();
      const cascade = await resolveAnalysisCascade();
      return remediateAnalysis(gap, cascade.map((c) => c.model), cascade, {
        ...budget,
        costPer1K: cheapestCostPer1K(cascade),
      });
    },
  });
  return useCase.execute(params);
}
