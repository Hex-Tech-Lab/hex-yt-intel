/**
 * JevFallbackBudget (T3, 10X PR scan P2 — unbounded slice-fallback spend).
 *
 * RCA: `resolveCellTranscript`'s fallback silently re-runs the FULL transcript
 * with K=1 semantics; with up to K×G cells per analysis each fallback costs a
 * full-transcript call, and the A6 cap `analysis.jev.maxCostUsdCentsPerVideo`
 * was enforced only at plan time on the planned K — never re-checked when a
 * fallback upgraded a slice read to a full-transcript read.
 *
 * Contract (reuses the A6 cost model — no new formula): the plan carries
 * `costCapCents` (the registry cap it was planned under) and
 * `fullTranscriptCallCents` (PlanAnalysisUseCase's estimateCentsFor applied to
 * one whole-transcript grounded call). A fallback is granted only while
 *   plan.estimateCents + cumulativeFallbackCents + fullTranscriptCallCents
 *   <= costCapCents
 * where cumulativeFallbackCents is the worker's Redis ledger of fallbacks
 * already granted earlier in this analysis run (read-modify-write via the
 * existing UpstashCacheAdapter; cells dispatch sequentially per wave so the
 * lost-update window is a same-instant race between parallel fallbacks —
 * bounded by maxParallel, over-counts nothing, under-counts at most one
 * full-call per racing pair). Accounting is additive: the planned slice call
 * is already inside estimateCents, so a fallback is charged the FULL call on
 * top — over-counting by the slice-call delta, the safe direction for a spend
 * guard.
 *
 * Unenforceable plans (legacy stored plans, the degenerate K=1 fallback plan)
 * have no cap fields: the fallback is ALLOWED (current behavior preserved —
 * refusing would break the by-design fallback for pre-deploy plans) and the
 * caller logs. A tampered inline plan could inflate costCapCents — same trust
 * level as the rest of req.jevPlan today (the S2S-fetched plan is
 * HMAC-verified); binding the plan into the stream token is tracked debt.
 */

import * as Sentry from '@sentry/cloudflare';
import { DEFAULT_TTL_SECONDS } from './UpstashCacheAdapter';
import type { UpstashCacheAdapter } from './UpstashCacheAdapter';

/** The two A6 budget fields the plan carries into the worker (T3). Optional: legacy stored plans and the degenerate K=1 fallback plan omit them (the decision then reports unenforceable). */
export interface FallbackBudgetPlan {
  costCapCents?: number;
  fullTranscriptCallCents?: number;
}

export interface FallbackBudgetDecision {
  /** False when the plan carries no budget fields (legacy/degenerate) — allowed is then true by contract. */
  enforceable: boolean;
  allowed: boolean;
  /** planned + cumulative + this fallback, in USD cents (NaN when unenforceable). */
  projectedCents: number;
  capCents: number;
}

/**
 * Pure A6-budget decision. Negative inputs are clamped to 0: `estimateCents`
 * arrives in the client-forwarded inline plan, so a forged negative value must
 * not loosen the guard.
 */
export function evaluateFallbackBudget(params: {
  plan?: FallbackBudgetPlan;
  plannedCents: number;
  cumulativeFallbackCents: number;
}): FallbackBudgetDecision {
  const plan = params.plan;
  const capCents = plan?.costCapCents;
  const fullCall = plan?.fullTranscriptCallCents;
  if (
    !plan ||
    typeof capCents !== 'number' ||
    !Number.isFinite(capCents) ||
    typeof fullCall !== 'number' ||
    !Number.isFinite(fullCall)
  ) {
    return { enforceable: false, allowed: true, projectedCents: Number.NaN, capCents: Number.NaN };
  }
  const planned = Math.max(0, params.plannedCents);
  const cumulative = Math.max(0, params.cumulativeFallbackCents);
  const full = Math.max(0, fullCall);
  const projectedCents = planned + cumulative + full;
  return { enforceable: true, allowed: projectedCents <= capCents, projectedCents, capCents };
}

/** Redis ledger key: cumulative fallback cents for one analysis run. */
export function fallbackSpendKey(analysisId: string): string {
  return `jev-fallback-spend:${analysisId}`;
}

/** Parse the stored counter; absent/corrupt reads as 0 (a corrupt ledger must not brick the by-design fallback). */
export function parseCumulativeFallbackCents(raw: string | null): number {
  if (raw === null) return 0;
  const parsedCents = Number(raw);
  return Number.isFinite(parsedCents) && parsedCents >= 0 ? parsedCents : 0;
}

/** Write-side rounding so float sums stay a clean string on the wire (serialization precision, not a tunable). */
const CENT_PRECISION = 1e6;

function serializeCents(cents: number): string {
  return String(Math.round(cents * CENT_PRECISION) / CENT_PRECISION);
}

/**
 * Atomic budget check-and-record (PR #438 C5). The previous two-step
 * get→evaluate→set let two parallel fallback cells both read the same
 * cumulative value, both pass, and both record — under-counting spend past
 * the cap. ONE Lua script now reads the ledger, evaluates projected spend
 * against the cap, and records ONLY when within budget (same Redis round-trip
 * count as before: one EVAL replaces the GET+SET pair). Same rounding as
 * serializeCents so the wire value is byte-identical to the two-step writer.
 */
export const ATOMIC_FALLBACK_BUDGET_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]))
if cur == nil or cur < 0 then cur = 0 end
local projected = tonumber(ARGV[1]) + cur + tonumber(ARGV[2])
if projected <= tonumber(ARGV[3]) then
  local newCum = math.floor((cur + tonumber(ARGV[2])) * ${CENT_PRECISION} + 0.5) / ${CENT_PRECISION}
  redis.call('SET', KEYS[1], tostring(newCum), 'EX', ARGV[4])
  return {1, tostring(projected), tostring(newCum)}
end
return {0, tostring(projected), tostring(cur)}
`;

export interface FallbackBudgetOutcome {
  decision: FallbackBudgetDecision;
  /** The granted fallback's cost — written to the ledger by this call. */
  recordedCents: number;
}

/**
 * Read the run's fallback ledger, evaluate the A6 budget, and — when the
 * fallback is granted — record its full-transcript cost. One call per actual
 * slice fallback (a rare path: zero mismatches in the crucible run), so the
 * two Redis round-trips never sit on the per-cell hot path.
 *
 * The ledger holds ONLY fallback spend (cumulative + this call) — never the
 * planned estimate, which every later evaluation adds separately.
 *
 * Cache outages degrade fail-soft (get → null / set swallowed by the adapter):
 * the guard then runs on this request's planned-vs-cap comparison only, never
 * blocks the by-design fallback, and the adapter already logs the outage.
 */
export async function checkAndRecordFallbackBudget(params: {
  plan?: FallbackBudgetPlan;
  plannedCents: number;
  analysisId: string;
  cache?: UpstashCacheAdapter;
}): Promise<FallbackBudgetOutcome> {
  const atomic = await tryAtomicFallbackBudget(params);
  if (atomic) return atomic;
  const cumulativeFallbackCents = params.cache
    ? parseCumulativeFallbackCents(await params.cache.get(fallbackSpendKey(params.analysisId)))
    : 0;
  const decision = evaluateFallbackBudget({
    plan: params.plan,
    plannedCents: params.plannedCents,
    cumulativeFallbackCents,
  });
  if (!decision.enforceable || !decision.allowed) {
    return { decision, recordedCents: 0 };
  }
  const fullCall = Math.max(0, params.plan?.fullTranscriptCallCents ?? 0);
  if (params.cache && fullCall > 0) {
    await params.cache.set(
      fallbackSpendKey(params.analysisId),
      serializeCents(cumulativeFallbackCents + fullCall),
    );
  }
  return { decision, recordedCents: fullCall };
}

/**
 * Atomic path (C5): a single EVAL decides and records. Used when the cache
 * adapter supports eval and the plan is enforceable; null on ANY failure so
 * the caller degrades to the two-step path (fail-soft — never blocks the
 * by-design fallback).
 */
async function tryAtomicFallbackBudget(params: {
  plan?: FallbackBudgetPlan;
  plannedCents: number;
  analysisId: string;
  cache?: UpstashCacheAdapter;
}): Promise<FallbackBudgetOutcome | null> {
  const cache = params.cache;
  const capCents = params.plan?.costCapCents;
  const fullCallRaw = params.plan?.fullTranscriptCallCents;
  if (
    !cache ||
    typeof (cache as { eval?: unknown }).eval !== 'function' ||
    typeof capCents !== 'number' ||
    !Number.isFinite(capCents) ||
    typeof fullCallRaw !== 'number' ||
    !Number.isFinite(fullCallRaw)
  ) {
    return null;
  }
  const fullCall = Math.max(0, fullCallRaw);
  try {
    const result = await (cache as { eval: (script: string, key: string, args: string[]) => Promise<string[] | null> }).eval(
      ATOMIC_FALLBACK_BUDGET_LUA,
      fallbackSpendKey(params.analysisId),
      [
        serializeCents(Math.max(0, params.plannedCents)),
        serializeCents(fullCall),
        serializeCents(capCents),
        String(DEFAULT_TTL_SECONDS),
      ],
    );
    if (!result || result.length < 3) return null;
    const allowed = result[0] === '1';
    const projectedCents = Number(result[1]);
    const decision: FallbackBudgetDecision = {
      enforceable: true,
      allowed,
      projectedCents: Number.isFinite(projectedCents) ? projectedCents : Number.NaN,
      capCents,
    };
    return { decision, recordedCents: allowed ? fullCall : 0 };
  } catch (error) {
    console.error('[jev-fallback-budget]', {
      message: error instanceof Error ? error.message : String(error),
      analysisId: params.analysisId,
    });
    Sentry.captureMessage('jev fallback budget: atomic ledger check unavailable; degraded to two-step', {
      level: 'warning',
      tags: { operation: 'jev-fallback-budget' },
      contexts: { analysis: { analysisId: params.analysisId } },
    });
    return null;
  }
}
