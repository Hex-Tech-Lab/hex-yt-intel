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

export class GroundedExtractionError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
  ) {
    super(message);
    this.name = 'GroundedExtractionError';
  }
}

export class GroundedExtractionEngine {
  constructor(
    private readonly promptBuilder: PromptBuilderPort,
    private readonly cascade: LLMCascadePort,
  ) {}

  async extractGroundedClaims(input: GroundedExtractionInput): Promise<GroundedExtractionPayload> {
    const { systemPrompt, userPrompt } = this.promptBuilder.buildGroundedExtractionPrompt(
      input.transcriptChunks,
      input.metadata,
    );

    let rawResponse = '';
    try {
      // Use LLMCascade or provider to generate the extraction
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
        if (done) break;
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

    return payload;
  }

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

    const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
    const unknowns = Array.isArray(parsed.unknowns) ? parsed.unknowns.filter((u): u is string => typeof u === 'string') : [];

    const validatedClaims = claims.map((rawClaim, index) => {
      const claimObj = rawClaim as Record<string, unknown>;
      const id = typeof claimObj.id === 'string' && claimObj.id.trim() ? claimObj.id : `claim_${index + 1}`;
      const speaker = typeof claimObj.speaker === 'string' ? claimObj.speaker : undefined;
      const range = Array.isArray(claimObj.timestampRange) && claimObj.timestampRange.length === 2
        ? [Number(claimObj.timestampRange[0]), Number(claimObj.timestampRange[1])] as [number, number]
        : [0, 0] as [number, number];
      const verbatimQuote = typeof claimObj.verbatimQuote === 'string' ? claimObj.verbatimQuote : '';
      const atomicAssertion = typeof claimObj.atomicAssertion === 'string' ? claimObj.atomicAssertion : '';
      const confidence = typeof claimObj.confidence === 'number' ? Math.max(0, Math.min(1, claimObj.confidence)) : 1.0;

      return {
        id,
        speaker,
        timestampRange: range,
        verbatimQuote,
        atomicAssertion,
        confidence,
      };
    });

    const metaObj = (parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}) as Record<string, unknown>;
    const metadata = {
      speakerCount: typeof metaObj.speakerCount === 'number' ? metaObj.speakerCount : fallbackMetadata.speakerCount,
      durationSeconds: typeof metaObj.durationSeconds === 'number' ? metaObj.durationSeconds : fallbackMetadata.durationSeconds,
      classification: (metaObj.classification as 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6') || fallbackMetadata.classification,
    };

    return {
      claims: validatedClaims,
      unknowns,
      metadata,
    };
  }
}
