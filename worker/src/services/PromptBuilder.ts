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
import { DIMENSION_CONFIGS } from '../../../web/lib/config/synthesis';

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

    if (context.chunkIndex !== undefined && context.chunkIndex >= 1 && context.chunkIndex <= 11) {
      const details = DIMENSION_CONFIGS[context.chunkIndex];
      if (details) {
        const name = details.name;
        const extraInstructions = details.extraFields?.map(f => {
          if (f === 'persona') {
            return 'include the "persona" configuration block in the JSON root';
          }
          if (f === 'knowledgeGraph') {
            return 'generate and include the full "knowledgeGraph" object representing entities and relationships extracted from this content in the JSON root';
          }
          if (f === 'classification') {
            return 'generate and include the full "classification" object in the JSON root';
          }
          if (f === 'monetizationVerdict') {
            return 'generate and include the full "monetizationVerdict" object in the JSON root';
          }
          return '';
        }).filter(Boolean).join(', and ') || 'do NOT include persona, knowledgeGraph, classification, or monetizationVerdict fields';

        return `${basePrompt}

---
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (CHUNK ${context.chunkIndex}):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimension:
- ### DIMENSION ${context.chunkIndex} - ${name}

Your output JSON object must ONLY include this dimension inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0". You must also ${extraInstructions}.
Your response must enforce a strict maximum output restriction of 400 analytical words for the processed dimension payload.
Do NOT output any other dimensions. Do NOT include any other JSON root fields. Your response must be strict, raw JSON without markdown formatting. Ensure that your output strictly matches this layout.`;
      }
    }

    return basePrompt;
  }
}

