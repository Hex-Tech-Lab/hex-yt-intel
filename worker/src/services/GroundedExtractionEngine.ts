/**
 * GroundedExtractionEngine — Domain Service (Hexagonal-Lite)
 *
 * Dedicated runner for Part A of the Epistemic Schism (ADR 039).
 *
 * Responsibilities:
 * 1. Invokes the LLM using PromptBuilder.buildGroundedExtractionPrompt().
 * 2. Parses and validates the response strictly against the GroundedExtractionPayload schema.
 * 3. Flushes this validated payload to the persistence layer as a partial (Ghost Row)
 *    NON-BLOCKINGLY before Part B begins.
 */

import * as Sentry from '@sentry/cloudflare';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type {
  GroundedExtractionPayload,
} from '../types/grounded-extraction';

export interface GroundedExtractionInput {
  analysisId: string;
  videoId: string;
  transcriptChunks: Array<{ text: string; start: number; end: number; speaker?: string }>;
  metadata: {
    title?: string;
    speakerCount: number;
    durationSeconds: number;
    classification: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
  };
  /**
   * Persistence handler for flushing the partial/ghost row.
   * Executed non-blockingly via ctx.waitUntil or unawaited promise.
   */
  flushPartialGhostRow: (payload: GroundedExtractionPayload) => Promise<boolean>;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Thrown when the extraction LLM output cannot be parsed or validated.
 * `rawOutput` carries the untouched model text for diagnostics/remediation.
 */
export class GroundedExtractionError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
  ) {
    super(message);
    this.name = 'GroundedExtractionError';
  }
}

/**
 * Runs Part A of the ADR 039 Epistemic Schism: one sterile extraction LLM pass
 * over the transcript, strict payload validation, then a non-blocking ghost-row
 * flush before Part B starts.
 */
export class GroundedExtractionEngine {
  constructor(
    private readonly promptBuilder: PromptBuilderPort,
    private readonly cascade: LLMCascadePort,
  ) {}

  /**
   * Builds the grounded-extraction prompt, streams the LLM response, validates
   * it into a GroundedExtractionPayload, and schedules the ghost-row flush
   * (non-blocking via `input.waitUntil` when supplied). Throws
   * GroundedExtractionError on LLM or validation failure.
   */
  async extractGroundedClaims(input: GroundedExtractionInput): Promise<GroundedExtractionPayload> {
    const { systemPrompt, userPrompt } = this.promptBuilder.buildGroundedExtractionPrompt(
      input.transcriptChunks,
      input.metadata,
    );

    let rawResponse = '';
    try {
      if (!this.cascade.generateStream) {
        throw new GroundedExtractionError('LLMCascadePort does not support generateStream');
      }
      const stream = await this.cascade.generateStream({
        systemPrompt,
        userPrompt,
        maxTokens: 4096,
        temperature: 0.1, // Near-zero temperature for sterile factual extraction
      });

      const reader = stream.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          rawResponse += decoder.decode();
          break;
        }
        rawResponse += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
      }
    } catch (err: unknown) {
      const error = new GroundedExtractionError(
        `LLM extraction pass failed: ${(err as Error)?.message || String(err)}`,
      );
      Sentry.captureException(error, {
        tags: { operation: 'grounded_extraction_llm', analysisId: input.analysisId, videoId: input.videoId },
      });
      throw error;
    }

    // Parse and validate strictly against GroundedExtractionPayload schema
    const payload = GroundedExtractionEngine.parseAndValidate(rawResponse, input.metadata);

    // CRITICAL SEAM: Non-blocking Ghost Row flush before Part B executes.
    // The promise is scheduled via waitUntil or detached so it does not block returning payload.
    const persistPromise = input
      .flushPartialGhostRow(payload)
      .catch((flushErr) => {
        Sentry.captureException(flushErr, {
          tags: { operation: 'ghost_row_flush_error', analysisId: input.analysisId, videoId: input.videoId },
        });
        console.error('[GroundedExtractionEngine] Ghost row flush failed:', flushErr);
        return false;
      });

    if (input.waitUntil) {
      input.waitUntil(persistPromise);
    }
    // Without waitUntil the promise is detached by design (ghost-row flush is
    // best-effort); an unhandled rejection cannot escape because the catch
    // above already absorbs every flush error.

    return payload;
  }

  /**
   * Parses raw LLM output into a GroundedExtractionPayload. Drops claims with
   * an invalid timestampRange or empty verbatimQuote, de-duplicates claim IDs,
   * and keeps the router-decided classification from `fallbackMetadata`.
   * Throws GroundedExtractionError on unparseable or empty output.
   */
  public static parseAndValidate(
    rawText: string,
    fallbackMetadata: GroundedExtractionInput['metadata'],
  ): GroundedExtractionPayload {
    let cleanJson = rawText.trim();
    // Strip markdown code fences if model enclosed JSON
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseError) {
      console.warn('[GroundedExtractionEngine] JSON parse failed on raw extraction:', parseError);
      throw new GroundedExtractionError('Output from extraction LLM is not valid JSON.', rawText);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new GroundedExtractionError('Parsed output must be an object.', rawText);
    }

    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];
    const unknowns = Array.isArray(parsed.unknowns) ? parsed.unknowns.filter((u): u is string => typeof u === 'string') : [];

    // Reject payloads missing BOTH fields (`{}`, truncated output); an explicit
    // `{claims: [], unknowns: []}` remains a legitimate zero-claim extraction.
    if (!Array.isArray(parsed.claims) && !Array.isArray(parsed.unknowns)) {
      throw new GroundedExtractionError(
        'Extraction LLM returned neither claims nor unknowns (malformed/empty output).',
        rawText,
      );
    }

    const usedClaimIds = new Set<string>();
    const validatedClaims = rawClaims
      .map((rawClaim, index) => {
        const claimObj = rawClaim as Record<string, unknown>;
        let id = typeof claimObj.id === 'string' && claimObj.id.trim() ? claimObj.id : `claim_${index + 1}`;
        while (usedClaimIds.has(id)) id = `${id}_${index + 1}`;
        usedClaimIds.add(id);
        const speaker = typeof claimObj.speaker === 'string' ? claimObj.speaker : undefined;
        const rawRange = Array.isArray(claimObj.timestampRange) ? (claimObj.timestampRange as unknown[]) : null;
        const hasValidRange =
          rawRange !== null &&
          rawRange.length === 2 &&
          typeof rawRange[0] === 'number' &&
          typeof rawRange[1] === 'number' &&
          !Number.isNaN(rawRange[0]) &&
          !Number.isNaN(rawRange[1]);
        const range = hasValidRange && rawRange !== null
          ? [Number(rawRange[0]), Number(rawRange[1])] as [number, number]
          : null;
        const verbatimQuote = typeof claimObj.verbatimQuote === 'string' ? claimObj.verbatimQuote.trim() : '';
        const atomicAssertion = typeof claimObj.atomicAssertion === 'string' ? claimObj.atomicAssertion : '';
        // Absent model confidence is scored mid-range, never as certainty.
        const confidence = typeof claimObj.confidence === 'number' ? Math.max(0, Math.min(1, claimObj.confidence)) : 0.5;

        if (!range || !verbatimQuote) {
          console.warn(`[GroundedExtractionEngine] Dropping invalid claim at index ${index} (invalid timestampRange or empty verbatimQuote).`);
          return null;
        }

        return {
          id,
          speaker,
          timestampRange: range,
          verbatimQuote,
          atomicAssertion,
          confidence,
        };
      })
      .filter((claim): claim is NonNullable<typeof claim> => claim !== null);

    // Sensor-router provenance (ADR 039): the classification route is decided
    // upstream by routeFusion and is NOT overridable by the extraction model,
    // which never sees the router's evidence. Only speaker/duration counts may
    // be corrected by the model.
    const metaObj = (parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}) as Record<string, unknown>;

    const metadata = {
      speakerCount: typeof metaObj.speakerCount === 'number' ? metaObj.speakerCount : fallbackMetadata.speakerCount,
      durationSeconds: typeof metaObj.durationSeconds === 'number' ? metaObj.durationSeconds : fallbackMetadata.durationSeconds,
      classification: fallbackMetadata.classification,
    };

    return {
      claims: validatedClaims,
      unknowns,
      metadata,
    };
  }
}
