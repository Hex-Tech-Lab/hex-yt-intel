/**
 * Synthesis configuration and constants.
 */

/**
 * The total number of CORE dimensions (1-11).
 * Dimension 0 (Executive Digest) is synthesized from these 11 and is NOT counted in TOTAL_DIMENSIONS.
 * This value should NEVER be hard-coded — it comes from admin_settings.
 * TODO: Load from admin_settings table via settings context.
 */
export const TOTAL_DIMENSIONS = 11;
export const TOTAL_STREAMS = 5;

/**
 * Minimum derived dimensions for an analysis to count as "usable". Single source
 * of truth shared by the cache read path (below this a cached row is a miss) and
 * the reaper (below this a stuck row is failed rather than salvaged), so the two
 * never disagree on the same analysis state.
 */
export const MIN_USABLE_DIMENSIONS = 8;

// R1a (2026-09-29): this constant is now the CODE fallback only. The authority
// is the Settings Registry key `analysis.streamBundles` (type json), resolved
// server-side by CreateAnalysisUseCase and delivered to the client as
// `job.streamBundles`. Invariant enforced by assertBundlePartition below.
export const STREAM_BUNDLES: number[][] = [
  [1, 10],         // grounded: Apex Intelligence + Credibility & Risk
  [2, 4, 6],       // grounded: Provenance, Psychological, Comparative
  [5, 7],          // grounded: Core Intelligence, Implementation Systems
  [3, 8],          // grounded: Content Architecture + Semantic/KG (dim 8 = 8.1/8.2/8.4 only; 8.3 moves to the projective bundle in R1b)
  [9, 11],         // PROJECTIVE: Forward Foresight + Commercial Yield
];

/**
 * R1b (2026-09-29) — Layer 2 epistemic split at SUB-DIMENSION level.
 * Dimensions whose UCIS definitions are PROJECTIVE (external knowledge
 * allowed) rather than GROUNDED ("Universe of 1", transcript-only). A bundle
 * containing any of these runs in projective mode and consumes the grounded
 * bundles' settled output as prior_payload. Single source of truth shared by
 * the client dispatch (useSSEStream) and the worker prompt builder.
 * User-approved mapping (2026-09-29): grounded = 1-7, 8.1, 8.2, 8.4, 10;
 * projective = 8.3, 9, 11. Dim 8 itself is GROUNDED (its KG nodes/relations
 * feed chat grounding per ADR 008 and entity-click timestamp seek per
 * ADR 022); only sub-section 8.3 Cross-Domain Bridges is projective and is
 * carried as the top-level `crossDomainBridges` payload field.
 */
export const PROJECTIVE_DIMENSIONS: readonly number[] = [9, 11];

/**
 * Sub-dimension-level projective entries: 8.3 Cross-Domain Bridges. Not a
 * dimension number (it belongs to no emitted dimension object), so it cannot
 * live in PROJECTIVE_DIMENSIONS; it is requested by the projective bundle's
 * prompt and stitched back into dimension 8's content by
 * stitchChunksIntoPayload.
 */
export const PROJECTIVE_SUBDIMENSIONS: readonly string[] = ['8.3'];

/**
 * A bundle is PROJECTIVE iff any of its dimensions is a projective dimension
 * (dims 9/11). Note the inverse does NOT make a bundle grounded-only-relevant:
 * a grounded bundle containing dim 8 must still explicitly OMIT 8.3
 * (see PromptBuilder's epistemic constraint).
 */
export function isProjectiveBundle(dims: readonly number[]): boolean {
  return dims.some((d) => PROJECTIVE_DIMENSIONS.includes(d));
}

/**
 * R1a bundle-partition invariant (server-enforced before any registry-resolved
 * map reaches the client): exactly TOTAL_STREAMS bundles, every dimension
 * 1..TOTAL_DIMENSIONS appears EXACTLY once, no 0 and no duplicates.
 * Throws a precise message naming the first violated rule.
 */
export function assertBundlePartition(bundles: number[][]): void {
  if (!Array.isArray(bundles) || !bundles.every(Array.isArray)) {
    throw new Error('assertBundlePartition: expected an array of dimension arrays');
  }
  if (bundles.length !== TOTAL_STREAMS) {
    throw new Error(
      `assertBundlePartition: expected exactly ${TOTAL_STREAMS} bundles, got ${bundles.length}`
    );
  }
  const seen = new Set<number>();
  for (const bundle of bundles) {
    for (const dim of bundle) {
      if (!Number.isInteger(dim) || dim < 1 || dim > TOTAL_DIMENSIONS) {
        throw new Error(
          `assertBundlePartition: dimension ${dim} is outside the valid range 1..${TOTAL_DIMENSIONS}`
        );
      }
      if (seen.has(dim)) {
        throw new Error(`assertBundlePartition: dimension ${dim} appears more than once`);
      }
      seen.add(dim);
    }
  }
  for (let d = 1; d <= TOTAL_DIMENSIONS; d++) {
    if (!seen.has(d)) {
      throw new Error(`assertBundlePartition: dimension ${d} is missing from the partition`);
    }
  }
}

/**
 * Whether to abort all parallel streams if a single stream fails.
 * If false, the system attempts to provide a partial synthesis.
 *
 * Was `true` until 2026-09-09 (ADR 021 Phase 4): that setting meant the
 * FIRST bundle failure killed the whole analysis via settleAnalysis('error')
 * before persist ever ran with partial coverage, even though useSSEStream.ts's
 * own checkSettleState() already tolerates partial success and
 * buildDimensionStatus (stitch-analysis-chunks.ts) already marks a
 * partial-coverage row billing_status='failed' + validation_report.status=
 * 'partial' on persist -- the exact contract dimension-remediation.ts's async
 * cron (ADR 019) scans for. Flipping to `false` (paired with useSSEStream.ts's
 * one-retry-per-bundle) lets that already-correct downstream machinery
 * actually run instead of being starved by an all-or-nothing abort.
 */
export const ABORT_ON_PARTIAL_FAILURE = false;

export interface DimensionConfig {
  number: number;
  name: string;
  label: string;
  icon: string;
  span: 1 | 2 | 3;
  extraFields?: ('persona' | 'knowledgeGraph' | 'classification' | 'monetizationVerdict')[];
}

export const DIMENSION_CONFIGS: Record<number, DimensionConfig> = {
  0: { number: 0, name: 'EXECUTIVE DIGEST', label: 'Executive Digest', icon: 'solar:document-text-linear', span: 3 },
  1: { number: 1, name: 'APEX INTELLIGENCE', label: 'Apex Intelligence', icon: 'solar:stars-minimalistic-linear', span: 3, extraFields: ['persona'] },
  2: { number: 2, name: 'PROVENANCE, METADATA & VIRALITY PROFILE', label: 'Provenance & Metadata', icon: 'solar:link-round-angle-linear', span: 1 },
  3: { number: 3, name: 'CONTENT ARCHITECTURE & FIRST PRINCIPLES', label: 'Content Architecture', icon: 'solar:folder-with-files-linear', span: 1 },
  4: { number: 4, name: 'PSYCHOLOGICAL & RHETORICAL LAYER', label: 'Psychological Layer', icon: 'solar:user-linear', span: 1 },
  5: { number: 5, name: 'CORE INTELLIGENCE EXTRACTION', label: 'Core Intelligence', icon: 'solar:bolt-linear', span: 2 },
  6: { number: 6, name: 'COMPARATIVE & QUANTITATIVE ANALYSIS', label: 'Quantitative Analysis', icon: 'solar:chart-2-linear', span: 1 },
  7: { number: 7, name: 'IMPLEMENTATION SYSTEMS & WORKFLOWS', label: 'Implementation Systems', icon: 'solar:refresh-linear', span: 1 },
  8: { number: 8, name: 'SEMANTIC & KNOWLEDGE GRAPH FOUNDATION', label: 'Semantic Foundation', icon: 'solar:share-circle-linear', span: 1, extraFields: ['knowledgeGraph'] },
  9: { number: 9, name: 'FORWARD INTELLIGENCE & STRATEGIC FORESIGHT', label: 'Forward Foresight', icon: 'solar:graph-up-linear', span: 1 },
  10: { number: 10, name: 'CREDIBILITY, RISK & META-ASSESSMENT', label: 'Credibility & Risk', icon: 'solar:shield-check-linear', span: 1 },
  11: { number: 11, name: 'COMMERCIAL YIELD & MONETIZATION PROFILING', label: 'Commercial Yield', icon: 'solar:wad-of-money-linear', span: 2, extraFields: ['classification', 'monetizationVerdict'] },
};

