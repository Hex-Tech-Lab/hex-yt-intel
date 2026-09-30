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
import { isProjectiveBundle, STREAM_BUNDLES, assertBundlePartition, resolveJevMatrix } from '@/lib/config/synthesis';
import { fitPriorPayloadToCap, PRIOR_PAYLOAD_MAX_BYTES_FALLBACK } from '@/lib/config/prior-payload';
import { reduceGroundedChunks } from '@/lib/services/reduce-grounded-chunks';
import type { UCISDimension } from '@/lib/types/dimension';
import type { StreamToken } from '@/lib/types/stream-token';

export const PROJECTIVE_CONTEXT_REGISTRY_FALLBACK = {
  'analysis.layer2.projectiveContextRetryAfterMs': 1500,
  'analysis.layer2.projectiveContextMaxWaitMs': 20000,
} as const;

export interface PersistedChunk {
  chunk_index: number;
  // ADR 037 Addendum A: Jev chunk coordinate; 0/undefined for legacy rows.
  jev_chunk_index?: number | null;
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
  /** ADR 037 Addendum A: the analysis row's persisted stream_count (null = legacy row). */
  resolveStreamCount: (analysisId: string) => Promise<number | null>;
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

    const chunks = (await this.deps.findChunks(analysisId)) ?? [];
    // ADR 037 Addendum A: gate completeness over the expected (jev_chunk_index,
    // chunk_index) CELL set. streamCount comes from the persisted row (null =
    // legacy → TOTAL_STREAMS fallback); a K>1 stream requires EVERY Jev slice
    // of every grounded bundle before the projective bundle may start. The
    // projective bundles' reduced grounded context is built from the REDUCED
    // grounded dimensions (reduceGroundedChunks), not from one arbitrary Jev
    // slice.
    const ownsStreamCount = await this.deps.resolveStreamCount(analysisId);
    let jevMatrix: ReturnType<typeof resolveJevMatrix>;
    try {
      jevMatrix = resolveJevMatrix(ownsStreamCount, bundles);
    } catch (matrixErr) {
      console.error('[ProjectiveContextUseCase] stream_count incompatible with bundle partition:', matrixErr instanceof Error ? matrixErr.message : String(matrixErr));
      return { type: 'grounded_not_persisted', retryAfterMs: settings.retryAfterMs, maxWaitMs: settings.maxWaitMs };
    }
    const multiJev = jevMatrix.k > 1;

    // Race closure: every expected grounded CELL must have a PERSISTED chunk
    // row. A terminally failed/interrupted cell counts as settled (degraded
    // case); a missing row means "not yet".
    const groundedChunks: PersistedChunk[] = [];
    const byCell = new Map(chunks.map((chunk) => [`${chunk.jev_chunk_index ?? 0}:${chunk.chunk_index}`, chunk]));
    for (const cell of jevMatrix.cells) {
      if (jevMatrix.projectiveBundleIndices.includes(cell.chunkIndex)) continue;
      const chunk = byCell.get(`${cell.jevChunkIndex}:${cell.chunkIndex}`);
      if (!chunk) {
        return { type: 'grounded_not_persisted', retryAfterMs: settings.retryAfterMs, maxWaitMs: settings.maxWaitMs };
      }
      if (chunk.status === 'completed') groundedChunks.push(chunk);
    }

    // K>1: reduce the per-Jev-chunk grounded outputs deterministically (raw
    // payload dims fed as UCISDimension[], narrowed afterwards the same way
    // the legacy path narrows them). K=1: legacy flatMap — byte-identical.
    const groundedDimensions: unknown[] = multiJev
      ? reduceGroundedChunks(
          groundedChunks
            .map((chunk) => {
              const dims = Array.isArray(chunk.payload.dimensions) ? (chunk.payload.dimensions as UCISDimension[]) : [];
              const metadata = chunk.payload.metadata as { wordCount?: unknown } | undefined;
              const wordCount = typeof metadata?.wordCount === 'number' && metadata.wordCount > 0 ? metadata.wordCount : 0;
              return { jevChunkIndex: chunk.jev_chunk_index ?? 0, wordCount, dimensions: dims };
            }),
        ).dimensions
      : groundedChunks.flatMap((chunk) => groundedDimensionsOf(chunk.payload));
    const dimensions = groundedDimensions.filter(
      (dim): dim is GroundedDimension =>
        !!dim && typeof dim === 'object'
        && typeof (dim as GroundedDimension).number === 'number' && typeof (dim as GroundedDimension).content === 'string'
    );
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
