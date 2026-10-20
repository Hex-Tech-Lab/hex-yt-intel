export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { verifyContentSig } from '@/lib/stream-token';
import { canonicalJson } from '@/lib/utils/canonical-json';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { planAnalysis } from '@/lib/usecases/PlanAnalysisUseCase';
import { gateJevForUser, resolveJevConfig } from '@/lib/config/jev';
import { STREAM_BUNDLES, assertBundlePartition } from '@/lib/config/synthesis';
import { resolveAnalysisCascade } from '@/lib/config/cascade';

/**
 * Shared prompt prefix tokens sent with every grounded cell call (A6 input
 * estimate). The registry has no dedicated key for this yet; the planning
 * input's `promptPrefixTokens` is a worst-case estimate, not a tunable that
 * gates behaviour — 1,000 tokens matches the derivation comment in
 * 20261001090000_jev_max_cost_per_video_setting.sql.
 */
const PROMPT_PREFIX_TOKENS_ESTIMATE = 1000;

const PlanRequestSchema = z.object({
  videoId: z.string().min(1),
  transcript: z.string(),
  sig: z.string(),
  exp: z.number(),
});

/**
 * POST /api/analyses/[id]/plan — S2S endpoint (R3b 2.3, Option P1, ADR 037
 * Addendum A). Called by the worker after `fetchTranscriptIfMissing` and
 * BEFORE any grounded LLM call when the transcript was not known at job
 * creation. Computes the Jev plan server-side, persists it idempotently,
 * and returns the cell list.
 *
 * Idempotence contract: the plan is written once (conditional update on the
 * row still being plan-less); a second call returns the STORED plan — it
 * never re-chunks (A2: a retry re-runs rows inside the same matrix).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: analysisId } = await params;
  const rawBody: unknown = await request.json().catch(() => null);
  const parsed = PlanRequestSchema.safeParse(rawBody);
  if (!parsed.success || !analysisId) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { videoId, transcript, sig, exp } = parsed.data;

  // Whole-body content signature (same scheme as /persist and
  // /comments/persist-sample-run): canonical JSON of the raw request minus
  // sig/exp, so no field can be altered under a valid signature.
  const { sig: _omitSig, exp: _omitExp, ...signedBody } = rawBody as Record<string, unknown>;
  let isValid = false;
  try {
    isValid = await verifyContentSig(canonicalJson(signedBody), sig, {
      purpose: 'plan',
      id: analysisId,
      exp,
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { route: 'analyses-plan', phase: 'verifyContentSig' },
      extra: { analysisId, videoId },
    });
    return NextResponse.json({ error: 'Security configuration error' }, { status: 500 });
  }
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const persistence = new SupabasePersistenceAdapter();

  // Idempotence: a stored plan is authoritative — return it, never re-chunk.
  try {
    const existing = await persistence.findJevPlan({ analysisId });
    if (existing != null) {
      return NextResponse.json({ cached: true, plan: existing });
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { route: 'analyses-plan', phase: 'findJevPlan' },
      extra: { analysisId, videoId },
    });
    return NextResponse.json({ error: 'Plan lookup failed' }, { status: 500 });
  }

  // Resolve all plan inputs from the settings registry (no hardcoded tunables).
  const rawJev = await SupabaseSettingsAdapter.getRegistrySettings(
    [
      'analysis.jev.enabled',
      'analysis.jev.windowWords',
      'analysis.jev.windowStrideWords',
      'analysis.jev.deltaCdiThreshold',
      'analysis.jev.fluffCdiThreshold',
      'analysis.jev.minChunkTokens',
      'analysis.jev.maxChunkTokens',
      'analysis.jev.maxChunks',
      'analysis.jev.acronymMinLength',
      'analysis.jev.contentWordMinLength',
      'analysis.jev.countAcronyms',
      'analysis.jev.countProperNouns',
      'analysis.jev.countNumbers',
      'analysis.jev.countContentWords',
      'analysis.jev.maxCostUsdCentsPerVideo',
      'analysis.transcriptBudgetChars',
      'analysis.streamBundles',
      'analysis.maxOutputTokens.haiku',
      'analysis.maxOutputTokens.default',
    ],
    {
      'analysis.transcriptBudgetChars': 48000,
      'analysis.streamBundles': STREAM_BUNDLES,
      'analysis.maxOutputTokens.haiku': 8192,
      'analysis.maxOutputTokens.default': 16000,
    } as Record<string, unknown>
  );

  const jevConfig = await gateJevForUser(resolveJevConfig(rawJev), () => persistence.isAdminUser({ analysisId }));
  const transcriptBudgetChars = Math.max(
    1000,
    Number(rawJev['analysis.transcriptBudgetChars']) || 48000
  );
  const costCapCents = Number(rawJev['analysis.jev.maxCostUsdCentsPerVideo']);
  const maxOutputTokens = Math.max(
    Number(rawJev['analysis.maxOutputTokens.haiku']) || 8192,
    Number(rawJev['analysis.maxOutputTokens.default']) || 16000
  );

  let bundles = STREAM_BUNDLES;
  try {
    const candidate = rawJev['analysis.streamBundles'] as number[][];
    assertBundlePartition(candidate);
    bundles = candidate;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { route: 'analyses-plan', phase: 'stream-bundles-invariant' },
      extra: { registryValue: rawJev['analysis.streamBundles'] },
    });
  }

  // Worst-case pricing: the most expensive resolved cascade item. CascadeItem
  // cost is USD per 1K tokens — converted to USD per million tokens.
  const cascade = await resolveAnalysisCascade();
  const worstCost = cascade.reduce((max, item) => Math.max(max, item.cost ?? 0), 0);
  const usdPerMTok = worstCost * 1000;

  const plan = await planAnalysis({
    transcript,
    jevConfig,
    bundles,
    transcriptBudgetChars,
    costCapCents: Number.isFinite(costCapCents) ? costCapCents : 100,
    inputUsdPerMTok: usdPerMTok,
    outputUsdPerMTok: usdPerMTok,
    promptPrefixTokens: PROMPT_PREFIX_TOKENS_ESTIMATE,
    maxOutputTokens,
  });

  // Persist once (conditional update); if a concurrent caller won the race,
  // the stored plan is authoritative for this response too.
  const { plan: storedPlan, stored } = await persistence.persistJevPlan({
    analysisId,
    plan,
  });

  return NextResponse.json({ cached: !stored, plan: storedPlan });
}
