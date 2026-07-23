import {
  getExecutiveDigestSystemPrompt,
  buildExecutiveDigestUserMessage,
  parseExecutiveDigest,
  type ExecutiveDigest,
} from '@/lib/prompts/executive-digest';
import type {
  TextCompletionPort,
  CompletionModel,
  DigestPersistencePort,
  StoredExecutiveDigest,
} from '@/lib/ports/ExecutiveDigestPorts';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';

const MAX_DIGEST_PAYLOAD_BYTES = 100_000;

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
      select: 'analysis_markdown, analysis_payload, executive_digest',
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
      const completion = await this.completion.complete({
        system: systemPrompt,
        user: buildExecutiveDigestUserMessage(markdown),
        models,
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

    return { type: 'success', digest, cached: false };
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
