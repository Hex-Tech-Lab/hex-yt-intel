/**
 * PromptBuilder - Pure Service (stateless)
 *
 * Implements PromptBuilderPort. Wraps getUCISPrompt — the prompt IP is constructed
 * here and bundled into the worker by esbuild, so it never leaves the server.
 * Config-only / stateless: safe to share across requests.
 */

import { getUCISPrompt } from '../../../web/lib/prompts/factory';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { EngineContext } from '../ports/ReasoningEnginePort';

export class PromptBuilder implements PromptBuilderPort {
  /**
   * Build the UCIS v5.1 system prompt from domain objects.
   */
  async build(context: EngineContext): Promise<string> {
    const basePrompt = await getUCISPrompt({
      metadata: {
        title: context.metadata.title,
        channelTitle: context.metadata.channelTitle,
        viewCount: String(context.metadata.viewCount ?? ''),
        likeCount: String(context.metadata.likeCount ?? ''),
        commentCount: String(context.metadata.commentCount ?? ''),
        publishedAt: context.metadata.publishedAt,
      },
      transcript: context.transcript || '',
      persona: (context.persona as any) || 'p1',
      timezone: context.timezone || 'UTC',
      duration: context.metadata.duration || 0,
    });

    if (context.chunkIndex === 1) {
      return `${basePrompt}

---
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (CHUNK 1):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimensions:
- ### DIMENSION 1 - APEX INTELLIGENCE
- ### DIMENSION 2 - PROVENANCE, METADATA & VIRALITY PROFILE
- ### DIMENSION 3 - CONTENT ARCHITECTURE & FIRST PRINCIPLES
- ### DIMENSION 4 - PSYCHOLOGICAL & RHETORICAL LAYER

Your output JSON object must ONLY include these dimensions inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0", include the "persona" config, and include the array of dimensions 1 to 4. Do NOT output dimensions 5 to 11. Do NOT include knowledgeGraph, classification, or monetizationVerdict fields. Your response must be strict, raw JSON without markdown formatting.`;
    }

    if (context.chunkIndex === 2) {
      return `${basePrompt}

---
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (CHUNK 2):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimensions:
- ### DIMENSION 5 - CORE INTELLIGENCE EXTRACTION
- ### DIMENSION 6 - COMPARATIVE & QUANTITATIVE ANALYSIS
- ### DIMENSION 7 - IMPLEMENTATION SYSTEMS & WORKFLOWS
- ### DIMENSION 8 - SEMANTIC & KNOWLEDGE GRAPH FOUNDATION

Your output JSON object must ONLY include these dimensions inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0", and include the array of dimensions 5 to 8. You MUST generate and include the full "knowledgeGraph" object representing entities and relationships extracted from Dimension 8. Do NOT output dimensions 1 to 4 or 9 to 11. Do NOT include persona, classification, or monetizationVerdict fields. Your response must be strict, raw JSON without markdown formatting.`;
    }

    if (context.chunkIndex === 3) {
      return `${basePrompt}

---
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (CHUNK 3):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimensions:
- ### DIMENSION 9 - FORWARD INTELLIGENCE & STRATEGIC FORESIGHT
- ### DIMENSION 10 - CREDIBILITY, RISK & META-ASSESSMENT
- ### DIMENSION 11 - COMMERCIAL YIELD & MONETIZATION PROFILING

Your output JSON object must ONLY include these dimensions inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0", and include the array of dimensions 9 to 11. You MUST generate and include the full "classification" object and the "monetizationVerdict" object. Do NOT output dimensions 1 to 8. Do NOT include persona or knowledgeGraph fields. Your response must be strict, raw JSON without markdown formatting.`;
    }

    return basePrompt;
  }
}
