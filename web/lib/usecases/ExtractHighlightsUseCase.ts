import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';
import { computeSimHash64 } from '@/lib/utils/simhash';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import {
  buildHighlightsExtractionSystemPrompt,
  buildHighlightsExtractionUserMessage,
  parseHighlightsExtraction,
  MAX_PROMPT_TAKEAWAYS,
} from '@/lib/prompts/highlights-extraction';
import { buildVerbatimExcerpt } from '@/lib/prompts/highlights-reconciliation';
import { HIGHLIGHTS_REGISTRY_FALLBACK, calculateEffectiveHighlightBudget, clampHighlightsSetting } from '@/lib/utils/highlights-settings';
import type { TextCompletionPort, CompletionModel } from '@/lib/ports/ExecutiveDigestPorts';

/**
 * The persistence slice highlights extraction needs. A structural subset of
 * AnalysisPersistencePort -- SupabasePersistenceAdapter implements all three
 * (delegating to SupabaseAnalysisAdapter), so the same adapter instance the
 * persist route and digest use case already hold is reused without a new
 * wiring seam.
 */
export interface HighlightsPersistencePort {
  /** Real segment timing for the source video, if still within the 72h
   *  retention window (ADR 012). Null once the transcript is purged --
   *  highlights can only ever be generated while this is available. */
  getTranscriptSegments(videoId: string): Promise<Array<{ start: number; text: string }> | null>;

  /** Atomic replace via the `replace_analysis_highlights` RPC (one
   *  transaction -- a plain delete-then-insert could leave zero rows if the
   *  insert failed post-delete). Safe to call even if highlights already
   *  exist (idempotent replace). */
  saveHighlights(params: {
    analysisId: string;
    highlights: Array<{ idx: number; start: number; end: number; label: string; takeawayIdx?: number | null; verbatimExcerpt?: string }>;
  }): Promise<boolean>;

  /** Existing highlights for one analysis, ordered by idx. Used by the
   *  skipIfPresent short-circuit to avoid re-spending on an analysis the
   *  finalize path already covered. */
  findHighlightsForAnalysis(analysisId: string): Promise<Array<{ idx: number; start: number; end: number; label: string }>>;
}

export interface ExtractHighlightsParams {
  analysisId: string;
  videoId: string;
  /** Cheap cascade for the single extraction completion (reuses the digest
   *  cascade -- a short synthesis over transcript segments, same cost tier). */
  models: readonly CompletionModel[];
  /** When true (the default), skip the LLM call entirely if highlights
   *  already exist for this analysis. The persist route's finalize path is
   *  the authoritative first extractor (transcript is guaranteed warm
   *  there), so a re-persist, a late digest re-trigger, or a remediation
   *  re-run must not re-spend on an analysis that already has a valid set.
   *  Pass false only for an explicit force-re-extract. */
  skipIfPresent?: boolean;
  /** Optional executive digest key takeaways to map highlights against. */
  takeaways?: string[];
}

/**
 * Extract timestamped highlight keypoints from a video's transcript and
 * persist them to `analysis_highlights`.
 *
 * PRIMARY path: invoked from the analysis-finalize path
 * (analyses persist route), where the transcript has JUST
 * been upserted and is guaranteed within the 72h retention window (ADR 012).
 *
 * Fallback path: also invoked from `GenerateExecutiveDigestUseCase` (which
 * rides the lazy digest-generation pass). With `skipIfPresent` true, that
 * fallback only fires when the finalize path didn't produce a set (e.g. it
 * failed transiently) AND the transcript is still warm -- closing the window
 * where a digest generated after the 72h purge silently no-ops and leaves
 * the reel with nothing to render (real RCA, 2026-08-23: only 2 of 216
 * analyses had highlights because extraction was coupled to the lazy digest
 * pass, which usually fires after the transcript is purged).
 *
 * Best-effort by design: a failure here (LLM down, parse invalid, DB write
 * failed) must never break the primary work of the caller (persisting the
 * analysis / delivering the digest). Callers wrap invocations in `.catch`.
 */
export class ExtractHighlightsUseCase {
  constructor(
    private persistence: HighlightsPersistencePort,
    private completion: TextCompletionPort,
    private temporalGraph?: TemporalKnowledgePort
  ) {}

  async execute(params: ExtractHighlightsParams): Promise<void> {
    const { analysisId, videoId, models, skipIfPresent = true, takeaways = [] } = params;

    if (skipIfPresent) {
      // A read failure here must not block a fresh extraction attempt --
      // fall through to the real extraction if the existence check itself
      // blew up (e.g. a transient Postgres error).
      try {
        const existing = await this.persistence.findHighlightsForAnalysis(analysisId);
        if (existing.length > 0) return;
      } catch (readError) {
        console.warn('[extract-highlights] Existing highlights read check failed, proceeding to extraction:', readError);
      }
    }

    // The two reads are independent (the registry fetch doesn't depend on
    // segments) -- parallelized to save a round-trip on the common
    // non-empty-segments path (carried over from the pre-extraction digest
    // path, /simplify review 2026-08-20).
    const [segments, resolvedRegistry] = await Promise.all([
      this.persistence.getTranscriptSegments(videoId),
      SupabaseSettingsAdapter.getRegistrySettings(
        [
          'highlights.maxCount',
          'highlights.maxOutputTokens',
          'highlights.minSegmentDurationSeconds',
          'highlights.maxSegmentDurationSeconds',
        ],
        HIGHLIGHTS_REGISTRY_FALLBACK
      ),
    ]);
    // No transcript within the 72h window -- there is no other source of
    // real segment timing (ADR 012), so this is a real, expected outcome
    // for an old/re-generated analysis, not an error to surface.
    if (!segments || segments.length === 0) return;

    // Registry-resolved, not hardcoded (2026-08-20 -- see
    // 20260820120000_highlights_reel_uncap_settings.sql RCA). maxOutputTokens
    // in particular used to be unset, silently falling back to
    // DEFAULT_MAX_TOKENS=2000 -- too small for a dense video's full highlight
    // set, truncating the response mid-array. Same bounds as the migration's
    // own validation jsonb.
    const maxCount = clampHighlightsSetting(
      resolvedRegistry['highlights.maxCount'],
      HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxCount'],
      4,
      80
    );
    const maxOutputTokens = clampHighlightsSetting(
      resolvedRegistry['highlights.maxOutputTokens'],
      HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxOutputTokens'],
      500,
      8000
    );
    const minSegmentDuration = clampHighlightsSetting(
      resolvedRegistry['highlights.minSegmentDurationSeconds'],
      HIGHLIGHTS_REGISTRY_FALLBACK['highlights.minSegmentDurationSeconds'],
      1,
      30
    );
    const maxSegmentDuration = clampHighlightsSetting(
      resolvedRegistry['highlights.maxSegmentDurationSeconds'],
      HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxSegmentDurationSeconds'],
      10,
      300
    );

    const promptTakeaways = (takeaways || []).slice(0, MAX_PROMPT_TAKEAWAYS /* ellipsis: array slice ... */);

    const completion = await this.completion.complete({
      system: buildHighlightsExtractionSystemPrompt(maxCount, maxSegmentDuration),
      user: buildHighlightsExtractionUserMessage(segments, promptTakeaways),
      models,
      maxTokens: maxOutputTokens,
      analysisId,
    });

    const validStarts = new Set(segments.map((segment) => segment.start));
    const lastSegment = segments[segments.length - 1];
    const estimatedVideoDuration = lastSegment ? lastSegment.start + 10 : 0;
    const baseBudgetSeconds = calculateEffectiveHighlightBudget(estimatedVideoDuration, promptTakeaways.length, 15);
    const effectiveBudgetSeconds = Math.max(baseBudgetSeconds, promptTakeaways.length * minSegmentDuration);
    const result = parseHighlightsExtraction(
      completion.text,
      validStarts,
      maxCount,
      minSegmentDuration,
      maxSegmentDuration,
      { takeawaysCount: promptTakeaways.length, maxCumulativeDuration: effectiveBudgetSeconds }
    );

    // 'invalid' means the model response was unparseable -- a transient LLM
    // failure, not a genuine "no highlights" finding. Must NOT touch any
    // existing highlight set in that case (real data-loss bug caught in
    // review: a bad response used to silently wipe a prior valid set via an
    // empty-array save). Only 'ok' (structurally valid, empty or not) is
    // ever persisted.
    if (result.status === 'invalid') {
      console.warn(`[extract-highlights] Model response unparseable for ${analysisId}; leaving any existing set untouched`);
      return;
    }

    // Never persist an empty result. The model returning [] means "nothing
    // noteworthy this time" -- but `skipIfPresent`'s existence read may have
    // been skipped (force) OR may have thrown and fallen through (transient
    // DB error caught above), so we cannot be sure no prior valid set exists.
    // saveHighlights is an atomic REPLACE (replace_analysis_highlights RPC),
    // so an empty-array save would silently wipe a previously-extracted,
    // still-valid set -- the exact data-loss bug class the 'invalid' guard
    // above protects against, extended here to the empty-but-valid case.
    // Skipping the save leaves the table as-is (existing set, or empty for a
    // first run with nothing noteworthy) -- correct in both cases.
    if (this.temporalGraph && segments.length > 0) {
      const anchors = [];
      const windowSize = 30;
      const maxTime = Math.max(...segments.map((s) => s.start));
      for (let windowStart = 0; windowStart <= maxTime; windowStart += windowSize) {
        const windowEnd = windowStart + windowSize;
        const windowSegments = segments.filter(
          (s) => s.start >= windowStart && s.start < windowEnd
        );
        if (windowSegments.length > 0) {
          const rawText = windowSegments.map((s) => s.text).join(' ');
          const tokens = rawText.split(/\s+/).filter(Boolean);
          const simhash64 = computeSimHash64(tokens);
          const verbatimAnchor = rawText.length > 200 ? `${rawText.slice(0, 200)}...` : rawText;
          
          anchors.push({ 
            windowStart, 
            windowEnd, 
            simhash64, 
            salientClaim: null, 
            verbatimAnchor 
          });
        }
      }
      if (anchors.length > 0) {
        const success = await this.temporalGraph.storeSimHashAnchors({ analysisId, anchors });
        if (!success) {
          throw new Error('Failed to persist temporal simhash anchors');
        }
      }
    }

    if (result.highlights.length === 0) return;

    await this.persistence.saveHighlights({
      analysisId,
      highlights: result.highlights.map((highlight, idx) => ({
        idx,
        start: highlight.start,
        end: highlight.end,
        label: highlight.label,
        takeawayIdx: highlight.takeawayIdx ?? null,
        verbatimExcerpt: buildVerbatimExcerpt(highlight.start, highlight.end, segments),
      })),
    });
  }
}
