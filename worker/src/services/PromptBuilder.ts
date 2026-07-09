import { getUCISPrompt } from '../../../web/lib/prompts/factory';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { EngineContext } from '../ports/ReasoningEnginePort';
import { DIMENSION_CONFIGS, TOTAL_DIMENSIONS } from '../../../web/lib/config/synthesis';
import type { PersonaId } from '../../../web/lib/types/persona';

export class PromptBuilder implements PromptBuilderPort {
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
      persona: (context.persona as PersonaId | undefined) || 'creator',
      timezone: context.timezone || 'UTC',
      duration: context.metadata.duration || 0,
      skipAllDimensionsInstruction: true,
    });

    if (context.dimensions !== undefined && context.dimensions.length > 0) {
      const dims = context.dimensions
        .filter(d => Number.isInteger(d) && d >= 1 && d <= TOTAL_DIMENSIONS)
        .filter((d, i, arr) => arr.indexOf(d) === i);
      if (dims.length === 0) return basePrompt;
      const allExtraFields = new Set<string>();
      const extraInstrParts: string[] = [];
      for (const d of dims) {
        const cfg = DIMENSION_CONFIGS[d];
        if (cfg?.extraFields) {
          for (const f of cfg.extraFields) {
            if (!allExtraFields.has(f)) {
              allExtraFields.add(f);
              if (f === 'persona') extraInstrParts.push('include the "persona" configuration block in the JSON root');
              else if (f === 'knowledgeGraph') extraInstrParts.push('generate and include the full "knowledgeGraph" object in the JSON root (max 15 nodes, 20 edges)');
              else if (f === 'classification') extraInstrParts.push('generate and include the full "classification" object in the JSON root');
              else if (f === 'monetizationVerdict') extraInstrParts.push('generate and include the full "monetizationVerdict" object in the JSON root');
            }
          }
        }
      }
      const extraInstr = extraInstrParts.length > 0
        ? extraInstrParts.join(', and ')
        : 'do NOT include persona, knowledgeGraph, classification, or monetizationVerdict fields';

      const dimLabels = dims.map(d => {
        const cfg = DIMENSION_CONFIGS[d];
        return cfg ? `- ### DIMENSION ${d} - ${cfg.name}` : `- ### DIMENSION ${d}`;
      }).join('\n');

      const label = dims.length === 1
        ? `DIMENSION ${dims[0]}`
        : `DIMENSIONS ${dims.join(', ')}`;

      return `${basePrompt}

---
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (${label}):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimension(s):
${dimLabels}

Your output JSON object must ONLY include these dimension(s) inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0". You must also ${extraInstr}.
Your response must enforce a strict maximum output restriction of 400 analytical words per dimension.
Do NOT output any other dimensions. Do NOT include any other JSON root fields. Your response must be strict, raw JSON without markdown formatting. Ensure that your output strictly matches this layout.`;
    }

    return basePrompt;
  }
}
