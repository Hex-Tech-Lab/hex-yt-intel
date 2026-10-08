/**
 * ProjectiveSynthesisEngine — Domain Service (Hexagonal-Lite)
 *
 * Dedicated runner for Part B of the Epistemic Schism (ADR 039).
 *
 * Operates EXCLUSIVELY over Part A's GroundedExtractionPayload.
 * Rejects raw transcripts. Enforces explicit citation of Part A Claim IDs
 * for all forward-looking market projections.
 */

import * as Sentry from '@sentry/cloudflare';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { LLMCascadePort } from '../ports/LLMCascadePort';
import type { GroundedExtractionPayload } from '../types/grounded-extraction';

export interface StrategicProjection {
  id: string;
  citedClaimIds: string[];
  implication: string;
  marketHorizon: 'near-term' | 'mid-term' | 'long-term';
  confidence: number;
}

export interface ProjectiveSynthesisPayload {
  schemaVersion: '2.0';
  persona: string;
  synthesis: {
    coreThesis: string;
    projections: StrategicProjection[];
    unsupportedQuestions: string[];
  };
}

export interface ProjectiveSynthesisInput {
  analysisId: string;
  videoId: string;
  groundedPayload: GroundedExtractionPayload;
  persona?: string;
}

/**
 * Thrown when the synthesis LLM output cannot be parsed or violates the
 * ADR 039 grounding constraints. `rawOutput` carries the untouched model text.
 */
export class ProjectiveSynthesisError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
  ) {
    super(message);
    this.name = 'ProjectiveSynthesisError';
  }
}

/**
 * Runs Part B of the ADR 039 Epistemic Schism: projective synthesis over
 * Part A's validated claims only, with citation of valid claim IDs enforced.
 */
export class ProjectiveSynthesisEngine {
  constructor(
    private readonly promptBuilder: PromptBuilderPort,
    private readonly cascade: LLMCascadePort,
  ) {}

  /**
   * Builds the projective-synthesis prompt from the grounded payload, streams
   * the LLM response, and validates it into a ProjectiveSynthesisPayload.
   * Throws ProjectiveSynthesisError on invalid input, LLM failure, or an
   * ungrounded/empty synthesis.
   */
  async synthesizeProjections(input: ProjectiveSynthesisInput): Promise<ProjectiveSynthesisPayload> {
    if (!input.groundedPayload || !Array.isArray(input.groundedPayload.claims)) {
      throw new ProjectiveSynthesisError('Part B synthesis requires a valid Part A GroundedExtractionPayload.');
    }

    const { systemPrompt, userPrompt } = this.promptBuilder.buildProjectiveSynthesisPrompt(
      input.groundedPayload,
      input.persona,
    );

    let rawResponse = '';
    try {
      if (!this.cascade.generateStream) {
        throw new ProjectiveSynthesisError('LLMCascadePort does not support generateStream');
      }
      const stream = await this.cascade.generateStream({
        systemPrompt,
        userPrompt,
        maxTokens: 4096,
        temperature: 0.3, // Measured temperature for strategic reasoning while respecting citations
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
      const error = new ProjectiveSynthesisError(
        `LLM projective synthesis pass failed: ${(err as Error)?.message || String(err)}`,
      );
      Sentry.captureException(error, {
        tags: { operation: 'projective_synthesis_llm', analysisId: input.analysisId, videoId: input.videoId },
      });
      throw error;
    }

    return ProjectiveSynthesisEngine.parseAndValidate(
      rawResponse,
      input.groundedPayload,
      input.persona || 'creator',
    );
  }

  /**
   * Parses raw synthesis LLM output into a ProjectiveSynthesisPayload.
   * Filters citedClaimIds to valid claim IDs, requires the coreThesis and
   * every projection to cite at least one valid claim, and skips malformed
   * projection entries. Throws ProjectiveSynthesisError on unparseable or
   * ungrounded output.
   */
  public static parseAndValidate(
    rawText: string,
    groundedPayload: GroundedExtractionPayload,
    persona: string,
  ): ProjectiveSynthesisPayload {
    let cleanJson = rawText.trim();
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseError: unknown) {
      console.error('[ProjectiveSynthesisEngine] JSON parse failed on raw text:', parseError);
      throw new ProjectiveSynthesisError('Output from synthesis LLM is not valid JSON.', rawText);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ProjectiveSynthesisError('Parsed synthesis output must be a JSON object.', rawText);
    }

    const validClaimIds = new Set(groundedPayload.claims.map((claimItem) => claimItem.id));
    const synthesisObj = (parsed.synthesis && typeof parsed.synthesis === 'object' ? parsed.synthesis : {}) as Record<
      string,
      unknown
    >;

    if (Object.keys(synthesisObj).length === 0) {
      throw new ProjectiveSynthesisError(
        'Synthesis LLM returned no synthesis object (empty output).',
        rawText,
      );
    }

    const coreThesis = typeof synthesisObj.coreThesis === 'string' ? synthesisObj.coreThesis : '';
    const rawProjections = Array.isArray(synthesisObj.projections) ? synthesisObj.projections : [];

    // ADR 039 Epistemic Schism constraint applies to the thesis too: it must
    // cite at least one valid Part A claim ID, same as every projection.
    // Vacuous when Part A produced zero claims — there is nothing to cite.
    if (validClaimIds.size > 0) {
      const thesisCitations = (coreThesis.match(/\[(claim_[^\]\s]+)\]/g) ?? [])
        .map((token) => token.slice(1, -1).trim())
        .filter((cid) => validClaimIds.has(cid));
      if (thesisCitations.length === 0) {
        throw new ProjectiveSynthesisError(
          'Synthesis LLM produced a coreThesis without citing any valid Grounded Claim ID.',
          rawText,
        );
      }
    }

    const projections: StrategicProjection[] = rawProjections
      .map((proj, idx) => {
        if (proj === null || typeof proj !== 'object' || Array.isArray(proj)) {
          console.warn(`[ProjectiveSynthesisEngine] Skipping malformed projection at index ${idx}.`);
          return null;
        }
        const projRecord = proj as Record<string, unknown>;
        const id = typeof projRecord.id === 'string' && projRecord.id ? projRecord.id : `proj_${idx + 1}`;
        const cited = Array.isArray(projRecord.citedClaimIds)
          ? projRecord.citedClaimIds.filter((cid): cid is string => typeof cid === 'string' && validClaimIds.has(cid))
          : [];

        // ADR 039 Epistemic Schism constraint: Projections MUST be grounded in at least one valid claim
        if (cited.length === 0) {
          return null;
        }

        const implication = typeof projRecord.implication === 'string' ? projRecord.implication : '';
        const marketHorizon: 'near-term' | 'mid-term' | 'long-term' =
          projRecord.marketHorizon === 'near-term' ||
          projRecord.marketHorizon === 'mid-term' ||
          projRecord.marketHorizon === 'long-term'
            ? projRecord.marketHorizon
            : 'mid-term';
        const confidence =
          typeof projRecord.confidence === 'number' ? Math.max(0, Math.min(1, projRecord.confidence)) : 0.8;

        return {
          id,
          citedClaimIds: cited,
          implication,
          marketHorizon,
          confidence,
        };
      })
      .filter((projection): projection is NonNullable<typeof projection> => projection !== null);

    const unsupportedQuestions = Array.isArray(synthesisObj.unsupportedQuestions)
      ? synthesisObj.unsupportedQuestions.filter((q): q is string => typeof q === 'string')
      : [];

    return {
      schemaVersion: '2.0',
      persona,
      synthesis: {
        coreThesis,
        projections,
        unsupportedQuestions,
      },
    };
  }
}
