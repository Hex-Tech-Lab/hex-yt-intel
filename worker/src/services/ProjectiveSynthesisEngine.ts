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

export class ProjectiveSynthesisError extends Error {
  constructor(
    message: string,
    public readonly rawOutput?: string,
  ) {
    super(message);
    this.name = 'ProjectiveSynthesisError';
  }
}

export class ProjectiveSynthesisEngine {
  constructor(
    private readonly promptBuilder: PromptBuilderPort,
    private readonly cascade: LLMCascadePort,
  ) {}

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
        if (done) break;
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
    } catch {
      throw new ProjectiveSynthesisError('Output from synthesis LLM is not valid JSON.', rawText);
    }

    const validClaimIds = new Set(groundedPayload.claims.map((c) => c.id));
    const synthesisObj = (parsed.synthesis && typeof parsed.synthesis === 'object' ? parsed.synthesis : {}) as Record<
      string,
      unknown
    >;

    const coreThesis = typeof synthesisObj.coreThesis === 'string' ? synthesisObj.coreThesis : '';
    const rawProjections = Array.isArray(synthesisObj.projections) ? synthesisObj.projections : [];

    const projections: StrategicProjection[] = rawProjections.map((proj, idx) => {
      const p = proj as Record<string, unknown>;
      const id = typeof p.id === 'string' && p.id ? p.id : `proj_${idx + 1}`;
      const cited = Array.isArray(p.citedClaimIds)
        ? p.citedClaimIds.filter((cid): cid is string => typeof cid === 'string' && validClaimIds.has(cid))
        : [];

      const implication = typeof p.implication === 'string' ? p.implication : '';
      const marketHorizon =
        p.marketHorizon === 'near-term' || p.marketHorizon === 'mid-term' || p.marketHorizon === 'long-term'
          ? p.marketHorizon
          : 'mid-term';
      const confidence = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.8;

      return {
        id,
        citedClaimIds: cited,
        implication,
        marketHorizon,
        confidence,
      };
    });

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
