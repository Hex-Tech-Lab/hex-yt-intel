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
import { DIMENSION_CONFIGS, TOTAL_DIMENSIONS } from '../../../web/lib/config/synthesis';

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

    if (context.transcript === '[Transcript unavailable' || !context.transcript || context.transcript.length < 20) {
      return basePrompt;
    }

    if (context.dimensions !== undefined && context.dimensions.length > 0) {
      const dimensionEntries = context.dimensions
        .map(d => {
          const cfg = DIMENSION_CONFIGS[d];
          return cfg ? `DIMENSION ${d} - ${cfg.name}` : `DIMENSION ${d}`;
        })
        .join(', ');

      const allExtraFields = new Set<string>();
      const extraInstrParts: string[] = [];
      for (const d of context.dimensions) {
        const cfg = DIMENSION_CONFIGS[d];
        if (cfg?.extraFields) {
          for (const f of cfg.extraFields) {
            if (!allExtraFields.has(f)) {
              allExtraFields.add(f);
              if (f === 'persona') {
                extraInstrParts.push('include the "persona" configuration block in the JSON root');
              } else if (f === 'knowledgeGraph') {
                extraInstrParts.push('generate and include the full "knowledgeGraph" object representing entities and relationships extracted from this content in the JSON root (strictly limit the output to a maximum of 15 critical nodes and 20 relational edges to ensure token efficiency. The knowledge graph MUST form a single, weakly connected component. You are strictly forbidden from generating isolated nodes; every node must have at least one incoming or outgoing edge [degree >= 1]. If your extraction results in separate conceptual clusters, you must synthesize logical "Cross-Domain Bridges" to connect them to the primary root node. The "rootId" must be assigned to the node with the highest out-degree centrality, i.e., the concept that spawns the most sub-concepts. If the extraction exceeds these limits, prioritize the most central entities, prune peripheral leaf nodes, and note any omitted clusters or truncation in the node content where relevant)');
              } else if (f === 'classification') {
                extraInstrParts.push('generate and include the full "classification" object in the JSON root');
              } else if (f === 'monetizationVerdict') {
                extraInstrParts.push('generate and include the full "monetizationVerdict" object in the JSON root');
              }
            }
          }
        }
      }
      const extraInstructions = extraInstrParts.length > 0
        ? extraInstrParts.join(', and ')
        : 'do NOT include persona, knowledgeGraph, classification, or monetizationVerdict fields';

      const dimensionList = context.dimensions.map(d => {
        const cfg = DIMENSION_CONFIGS[d];
        return cfg ? `- ### DIMENSION ${d} - ${cfg.name}` : `- ### DIMENSION ${d}`;
      }).join('\n');

      const executionLine = 'Analyse the provided content using the framework above. You are operating in a CLOSED UNIVERSE. The transcript is your only source of truth. Output MUST be a raw JSON object.';

      const focusBlock = `## FOCUS — THIS REQUEST ONLY
You are performing a SEGMENTED analysis. Generate ONLY the following dimensions:
${dimensionList}

Your JSON object must contain ONLY these dimensions in the "dimensions" array. Start the JSON envelope with "schemaVersion": "2.0". You must also ${extraInstructions}.
Maximum 400 analytical words per dimension.
Do NOT output any other dimensions. Do NOT include persona, knowledgeGraph, classification, or monetizationVerdict in the root unless instructed above.`;

      const executionBlock = `## EXECUTION
${executionLine}

**CRITICAL REMINDER**: External data enrichment, web searching, and inference beyond the transcript boundary are FORBIDDEN. When data is absent, use the circuit breaker.

**FOCUS OVERRIDE — MANDATORY**: The ## FOCUS section above specifies exactly which dimensions to generate. Generate ONLY those dimensions. Do NOT generate any others. This takes precedence over all other instructions.`;

      const strippedPrompt = basePrompt.includes('## EXECUTION')
        ? basePrompt.slice(0, basePrompt.indexOf('## EXECUTION'))
        : basePrompt;

      return `${strippedPrompt}

${focusBlock}

${executionBlock}`;
    }

    return `${basePrompt}

---
CRITICAL INSTRUCTION:
Generate a complete 11-dimension UCIS v2.0 structured analysis in raw JSON format.
Your output must be a single JSON object with the following root fields:
- "schemaVersion": "2.0"
- "persona": Full persona configuration
- "dimensions": An array containing all 11 dimensions (number, name, content)
- "knowledgeGraph": A weakly connected graph (max 15 nodes, 20 edges)
- "classification": Object with boolean flags (authoritative, practicallyActionable, knowledgeGraphReady, safe) and a recommendation string
- "monetizationVerdict": Target-specific commercial yield profiles

Output strictly raw JSON. Do NOT include markdown code blocks or any preamble/postamble.`;
  }
}

