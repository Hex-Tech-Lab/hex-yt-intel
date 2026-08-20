import {
  getExecutiveDigestSystemPrompt,
  buildExecutiveDigestUserMessage,
  parseExecutiveDigest,
  type ExecutiveDigest,
} from '@/lib/prompts/executive-digest';
import {
  buildHighlightsExtractionSystemPrompt,
  buildHighlightsExtractionUserMessage,
  parseHighlightsExtraction,
} from '@/lib/prompts/highlights-extraction';
import { HIGHLIGHTS_REGISTRY_FALLBACK } from '@/lib/utils/highlights-settings';
import type {
  TextCompletionPort,
  CompletionModel,
  DigestPersistencePort,
  StoredExecutiveDigest,
} from '@/lib/ports/ExecutiveDigestPorts';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';

const MAX_DIGEST_PAYLOAD_BYTES = 100_000;

// Registry-resolved (2026-08-18 -- see docs/research/2026-08-18-digest-fresh-haiku-baseline-fidelity-test.md
// for the RCA: GPT-OSS-120B, a reasoning model, hit finish_reason=length on
// 5/14 real rows at the prior hardcoded DEFAULT_MAX_TOKENS=2000 in
// OpenRouterCompletionAdapter.ts; Haiku 4.5 never truncated on the same rows).
// Fallback value is the real empirical derivation from
// docs/research/2026-08-18-digest-token-cap-empirical-study.md (n=24,
// observed max 2471 tokens x 1.18 margin = 3000), matching the live
// digest.maxOutputTokens registry value -- not a padded guess.
const DIGEST_MAX_TOKENS_FALLBACK = 3000;

/**
 * Prefer stored markdown; fall back to reconstructing from analysis_payload.
 *
 * RCA (2026-07-22): this used to read row.analysis_markdown only, with no
 * fallback -- the same gap fixed in getAnalysisGrounding (chat) for the
 * identical reason: chunked persistence can populate analysis_payload before
 * the analysis_markdown column catches up. Without this fallback, digest
 * generation 409'd ("markdown is empty") on analyses that had real content,
 * and the frontend has no retry-on-409 logic, so it looped/gave up silently.
 */
function reconstructDigestMarkdown(analysisMarkdown: unknown, analysisPayload: unknown): string {
  if (typeof analysisMarkdown === 'string' && analysisMarkdown.trim().length > 0) {
    return analysisMarkdown;
  }
  if (!analysisPayload || typeof analysisPayload !== 'object') return '';
  try {
    const payloadSize = new TextEncoder().encode(JSON.stringify(analysisPayload)).length;
    if (payloadSize > MAX_DIGEST_PAYLOAD_BYTES) return '';
    return reconstructMarkdown(analysisPayload as Parameters<typeof reconstructMarkdown>[0]);
  } catch {
    return '';
  }
}

export interface GenerateExecutiveDigestParams {
  analysisId: string;
  userId: string;
  /** Cheap cascade for the single digest completion. */
  models: readonly CompletionModel[];
  /** Re-generate even if a digest already exists (default false = idempotent). */
  force?: boolean;
}

export type GenerateExecutiveDigestResult =
  | { type: 'success'; digest: StoredExecutiveDigest; cached: boolean; isTemporary?: boolean }
  | { type: 'error'; code: string; status: number; message: string };

/**
 * Dimension 0 — generate (once) the three-tier executive digest for an owned,
 * completed analysis. Idempotent: if a digest already exists it is returned
 * without a second model call. The analysis must have usable markdown — an
 * empty analysis (no transcript) has nothing to digest, so we refuse rather
 * than invent, mirroring the chat grounding gate.
 */
export class GenerateExecutiveDigestUseCase {
  constructor(
    private persistence: DigestPersistencePort,
    private completion: TextCompletionPort
  ) {}

  async execute(params: GenerateExecutiveDigestParams): Promise<GenerateExecutiveDigestResult> {
    const { analysisId, userId, models, force = false } = params;

    const row = await this.persistence.verifyOwnership({
      analysisId,
      userId,
      select: 'analysis_markdown, analysis_payload, executive_digest, video_id',
    });
    if (!row) {
      return { type: 'error', code: 'ERR_ANALYSIS_NOT_FOUND', status: 404, message: 'Analysis not found' };
    }

    // Idempotency: return the stored digest untouched unless a re-gen is forced.
    if (!force && isStoredDigest(row.executive_digest)) {
      return { type: 'success', digest: row.executive_digest, cached: true };
    }

    const markdown = reconstructDigestMarkdown(row.analysis_markdown, row.analysis_payload).trim();
    if (markdown.length === 0) {
      console.warn(`[digest-usecase] Analysis ${analysisId} has empty markdown; analysis may still be persisting`);
      return {
        type: 'error',
        code: 'ERR_ANALYSIS_MARKDOWN_EMPTY',
        status: 409,
        message: 'Analysis markdown is empty; digest generation retried until content arrives',
      };
    }

    let text: string;
    let model: string;
    try {
      const systemPrompt = await getExecutiveDigestSystemPrompt();
      const resolvedMaxTokensRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
        ['digest.maxOutputTokens'],
        { 'digest.maxOutputTokens': DIGEST_MAX_TOKENS_FALLBACK }
      );
      const maxTokens = Number(resolvedMaxTokensRegistry['digest.maxOutputTokens']) || DIGEST_MAX_TOKENS_FALLBACK;
      const completion = await this.completion.complete({
        system: systemPrompt,
        user: buildExecutiveDigestUserMessage(markdown),
        models,
        maxTokens,
        analysisId,
        requestingUserId: userId,
      });
      text = completion.text;
      model = completion.model;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[digest-usecase] completion failed:', message);
      return { type: 'error', code: 'ERR_DIGEST_COMPLETION_FAILED', status: 502, message: 'Digest generation failed' };
    }

    const parsed: ExecutiveDigest | null = parseExecutiveDigest(text);
    if (!parsed) {
      return { type: 'error', code: 'ERR_DIGEST_UNPARSEABLE', status: 502, message: 'Digest could not be parsed' };
    }

    const isFallback = parsed.parsedVia === 'fallback';

    const digest: StoredExecutiveDigest = {
      ...parsed,
      model,
      generatedAt: new Date().toISOString(),
    };

    // Fallback digests are not persisted — they are transient and returned
    // only for client display. Refusals and near-empty text are already
    // rejected by the parser, so reaching here means we have something
    // worth showing but not storing.
    if (isFallback) {
      return { type: 'success', digest, cached: false, isTemporary: true };
    }

    const saved = await this.persistence.saveExecutiveDigest({ analysisId, userId, digest });
    if (!saved) {
      return { type: 'error', code: 'ERR_ANALYSIS_NOT_FOUND', status: 404, message: 'Analysis not found' };
    }

    // Highlights extraction rides this same pass -- see execute()'s doc
    // comment. Best-effort: a failure here must never break digest delivery,
    // which is the primary feature. Skipped entirely once the transcript's
    // 72h retention window (ADR 012) has closed -- there is no other source
    // of real segment timing, so a missing transcript here is a real, expected
    // outcome for an old/re-generated analysis, not an error to surface.
    if (row.video_id) {
      await this.extractHighlights({ analysisId, videoId: row.video_id, models }).catch((error) => {
        console.warn(`[digest-usecase] Highlights extraction failed for ${analysisId}:`, error);
      });
    }

    return { type: 'success', digest, cached: false };
  }

  /** See execute()'s doc comment for why this rides the digest pass. */
  private async extractHighlights(params: {
    analysisId: string;
    videoId: string;
    models: readonly CompletionModel[];
  }): Promise<void> {
    const segments = await this.persistence.getTranscriptSegments(params.videoId);
    if (!segments || segments.length === 0) return;

    // Registry-resolved, not hardcoded (2026-08-20 -- see
    // 20260820120000_highlights_reel_uncap_settings.sql RCA). maxOutputTokens
    // in particular used to be unset here, silently falling back to
    // OpenRouterCompletionAdapter's DEFAULT_MAX_TOKENS=2000 -- too small for
    // a dense video's full highlight set, truncating the response mid-array.
    const resolvedHighlightsRegistry = await SupabaseSettingsAdapter.getRegistrySettings(
      ['highlights.maxCount', 'highlights.maxOutputTokens'],
      HIGHLIGHTS_REGISTRY_FALLBACK
    );
    const maxCount = Number(resolvedHighlightsRegistry['highlights.maxCount']) || HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxCount'];
    const maxOutputTokens = Number(resolvedHighlightsRegistry['highlights.maxOutputTokens']) || HIGHLIGHTS_REGISTRY_FALLBACK['highlights.maxOutputTokens'];

    const completion = await this.completion.complete({
      system: buildHighlightsExtractionSystemPrompt(maxCount),
      user: buildHighlightsExtractionUserMessage(segments),
      models: params.models,
      maxTokens: maxOutputTokens,
      analysisId: params.analysisId,
    });

    const validStarts = new Set(segments.map((segment) => segment.start));
    const result = parseHighlightsExtraction(completion.text, validStarts, maxCount);

    // 'invalid' means the model response was unparseable -- a transient LLM
    // failure, not a genuine "no highlights" finding. Must NOT touch any
    // existing highlight set in that case (real data-loss bug caught in
    // review: a bad response used to silently wipe a prior valid set via an
    // empty-array save). Only 'ok' (structurally valid, empty or not) is
    // ever persisted.
    if (result.status === 'invalid') {
      console.warn(`[digest-usecase] Highlights extraction unparseable for ${params.analysisId}; leaving existing set untouched`);
      return;
    }

    await this.persistence.saveHighlights({
      analysisId: params.analysisId,
      highlights: result.highlights.map((highlight, idx) => ({ idx, start: highlight.start, end: highlight.end, label: highlight.label })),
    });
  }
}

/** Narrow persisted jsonb to a usable stored digest (has at least one tier). */
function isStoredDigest(value: unknown): value is StoredExecutiveDigest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const hasSnapshot = typeof v.snapshot === 'string' && v.snapshot.length > 0;
  const hasOverview = typeof v.overview === 'string' && v.overview.length > 0;
  const hasTakeaways = Array.isArray(v.takeaways) && v.takeaways.length > 0;
  return hasSnapshot || hasOverview || hasTakeaways;
}
