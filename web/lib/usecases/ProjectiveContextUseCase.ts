/**
 * R2b (2026-09-29): build and sign the grounded context for a projective
 * bundle from PERSISTED data (audit finding 8 + the #363 review's P1).
 *
 * Before R2b the browser assembled prior_payload from its in-memory nucleus,
 * so (a) a user could send invented "grounded evidence" into their projective
 * prompt, and (b) the projective bundle started when grounded STREAMS settled
 * in the browser, not when grounded chunks were PERSISTED (the persist-ACK
 * race). Here Vercel reads the persisted grounded chunks, shapes them with the
 * same fitter the worker guard accepts, and signs the result bound to the
 * analysis, an expiry, the projective dimensions and the payload hash.
 */
import { isProjectiveBundle, STREAM_BUNDLES, assertBundlePartition } from '@/lib/config/synthesis';
import { fitPriorPayloadToCap, PRIOR_PAYLOAD_MAX_BYTES_FALLBACK } from '@/lib/config/prior-payload';
import { parseStoredPlan } from '@/lib/jev/stored-plan';
import { reduceCellsToBundleRows, type CellRow } from '@/lib/jev/reduce-cells';
import type { StreamToken } from '@/lib/types/stream-token';

export const PROJECTIVE_CONTEXT_REGISTRY_FALLBACK = {
  'analysis.layer2.projectiveContextRetryAfterMs': 1500,
  'analysis.layer2.projectiveContextMaxWaitMs': 20000,
} as const;

export interface PersistedChunk {
  chunk_index: number;
  dimensions_covered: number[];
  payload: Record<string, unknown>;
  status: 'completed' | 'failed' | 'interrupted';
}

export type ProjectiveContextOutcome =
  | { type: 'not_found' }
  | { type: 'no_projective_bundle' }
  | { type: 'grounded_not_persisted'; retryAfterMs: number; maxWaitMs: number }
  | {
      type: 'ok';
      projectiveDimensions: number[];
      prior_payload: ReturnType<typeof fitPriorPayloadToCap>;
      contextSig: string;
      contextExp: number;
    };

export interface ProjectiveContextDeps {
  /** Owner-checked existence of the analysis (null = not found / not owned). */
  ownsAnalysis: (analysisId: string, userId: string) => Promise<boolean>;
  findChunks: (analysisId: string) => Promise<PersistedChunk[] | null>;
  /** R3b 2.5d: the stored Jev plan (K>1 analyses read cells instead of chunk-0 rows). */
  findJevPlan: (analysisId: string) => Promise<unknown>;
  findCells: (analysisId: string) => Promise<CellRow[] | null>;
  /** Registry values (analysis.streamBundles, priorPayloadMaxBytes, the two wait keys). */
  resolveSettings: () => Promise<{
    streamBundles: unknown;
    priorPayloadMaxBytes: unknown;
    retryAfterMs: number;
    maxWaitMs: number;
  }>;
  sign: (params: { analysisId: string; dimensions: readonly number[]; priorPayload: unknown }) => Promise<StreamToken>;
}

type GroundedDimension = { number: number; content: string };

/** Pull {number, content} grounded dimensions out of one persisted chunk payload. */
function groundedDimensionsOf(payload: Record<string, unknown>): GroundedDimension[] {
  const raw = Array.isArray(payload.dimensions) ? payload.dimensions : [];
  return raw
    .filter((dim): dim is GroundedDimension =>
      typeof dim === 'object' && dim !== null
      && typeof (dim as GroundedDimension).number === 'number'
      && typeof (dim as GroundedDimension).content === 'string')
    .filter((dim) => !isProjectiveBundle([dim.number]));
}

export class ProjectiveContextUseCase {
  constructor(private deps: ProjectiveContextDeps) {}

  /**
   * One row per bundle. K=1: today's chunk-0 rows. K>1 (R3b 2.5d): every
   * expected cell must be persisted before its bundle appears (a missing cell
   * keeps the bundle out, so the caller answers grounded_not_persisted); an
   * interrupted cell counts as settled-failed, matching how an interrupted
   * K=1 bundle already counts as settled here, and the bundle is reduced
   * from its completed cells exactly as the persist finalize does.
   */
  private async persistedBundleRows(analysisId: string): Promise<PersistedChunk[]> {
    const plan = parseStoredPlan(await this.deps.findJevPlan(analysisId));
    if (!plan || plan.K <= 1) return (await this.deps.findChunks(analysisId)) ?? [];
    const cells = ((await this.deps.findCells(analysisId)) ?? [])
      .map((cell) => (cell.status === 'interrupted' ? { ...cell, status: 'failed' as const } : cell));
    return reduceCellsToBundleRows(plan, cells).rows;
  }

  async execute(params: { analysisId: string; userId: string }): Promise<ProjectiveContextOutcome> {
    const { analysisId, userId } = params;
    if (!(await this.deps.ownsAnalysis(analysisId, userId))) return { type: 'not_found' };

    const settings = await this.deps.resolveSettings();
    let bundles: number[][] = STREAM_BUNDLES;
    try {
      assertBundlePartition(settings.streamBundles as number[][]);
      bundles = settings.streamBundles as number[][];
    } catch (partitionErr) {
      // Invalid registry map: CreateAnalysisUseCase already reported it to
      // Sentry and dispatched with STREAM_BUNDLES, so mirror that here.
      console.warn('[ProjectiveContextUseCase] invalid analysis.streamBundles, using STREAM_BUNDLES:', partitionErr instanceof Error ? partitionErr.message : String(partitionErr));
      bundles = STREAM_BUNDLES;
    }

    const projectiveBundle = bundles.find((bundle) => isProjectiveBundle(bundle));
    if (!projectiveBundle) return { type: 'no_projective_bundle' };

    const chunks = await this.persistedBundleRows(analysisId);
    const byIndex = new Map(chunks.map((chunk) => [chunk.chunk_index, chunk]));

    // Race closure: every grounded bundle must have a PERSISTED chunk row
    // (chunk_index = bundle index + 1). A terminally failed/interrupted chunk
    // counts as settled (degraded case); a missing row means "not yet".
    const groundedChunks: PersistedChunk[] = [];
    for (const [index, bundle] of bundles.entries()) {
      if (isProjectiveBundle(bundle)) continue;
      const chunk = byIndex.get(index + 1);
      if (!chunk) {
        return { type: 'grounded_not_persisted', retryAfterMs: settings.retryAfterMs, maxWaitMs: settings.maxWaitMs };
      }
      if (chunk.status === 'completed') groundedChunks.push(chunk);
    }

    const dimensions = groundedChunks.flatMap((chunk) => groundedDimensionsOf(chunk.payload));
    const resources = groundedChunks.flatMap((chunk) =>
      Array.isArray(chunk.payload.explicitSpeakerResources)
        ? chunk.payload.explicitSpeakerResources.filter((resource): resource is string => typeof resource === 'string')
        : []);
    const priorPayload = fitPriorPayloadToCap(
      dimensions,
      settings.priorPayloadMaxBytes ?? PRIOR_PAYLOAD_MAX_BYTES_FALLBACK,
      resources
    );
    const token = await this.deps.sign({ analysisId, dimensions: projectiveBundle, priorPayload });
    return {
      type: 'ok',
      projectiveDimensions: [...projectiveBundle],
      prior_payload: priorPayload,
      contextSig: token.sig,
      contextExp: token.exp,
    };
  }
}
