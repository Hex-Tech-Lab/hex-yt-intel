import { getUCISPrompt } from '../../../web/lib/prompts/factory';
import { UCIS_V5_4_SYSTEM } from '../../../web/lib/prompts/ucis-v5.4';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { PromptConfigPort } from '../ports/PromptConfigPort';
import type { EngineContext } from '../ports/ReasoningEnginePort';
import { DIMENSION_CONFIGS, TOTAL_DIMENSIONS, isProjectiveBundle } from '../../../web/lib/config/synthesis';
import type { PersonaId } from '../../../web/lib/types/persona';
import { isValidPersona } from '../../../web/lib/types/persona';

// RCA (2026-07-24): getUCISPrompt's default template resolution
// (resolveUCISPromptTemplate) reads Supabase/Redis credentials via
// process.env, which does not exist in the Workers isolate -- every request
// silently fell through (each layer's own try/catch swallowed it) to the
// hardcoded UCIS_V5_1_SYSTEM default. Confirmed live via Sentry issue
// HEX-YT-INTEL-3D. `promptConfig`, when supplied, resolves the live template
// via WorkerPromptConfigAdapter (Redis-only, ADR-005-compliant, no Postgres
// access from the worker) and is passed to getUCISPrompt as promptOverride
// so resolveUCISPromptTemplate's process.env path is never invoked here. No
// port supplied (e.g. Redis creds missing) -- falls back to the embedded
// UCIS_V5_1_SYSTEM text, same last-known-good behavior as before.
//
// The segmented-dimension instruction text below (dimLabels/
// extraFieldsInstruction/fallbackInstructions) remains hardcoded in this
// worker-only file -- smaller blast radius (dimension-count instructions,
// not the core analysis prompt) than the base template, deferred separately.
export class PromptBuilder implements PromptBuilderPort {
  constructor(private readonly promptConfig?: PromptConfigPort) {}

  async build(context: EngineContext): Promise<string> {
    const { sharedPrefix, segmentInstruction } = await this.buildSegmented(context);
    return sharedPrefix + segmentInstruction;
  }

  /**
   * Split the prompt into its cacheable shared prefix and the
   * bundle-specific segment instruction (prompt caching, 2026-09-25).
   * Contract: `sharedPrefix + segmentInstruction === build(context)`
   * byte-for-byte, and `sharedPrefix` is byte-identical across every
   * bundle of the same video (basePrompt depends only on
   * metadata/transcript/persona/timezone/duration -- never on
   * `context.dimensions` -- because skipAllDimensionsInstruction strips
   * the only dimension-dependent base-prompt section). That identity is
   * what makes the Anthropic `cache_control` breakpoint on sharedPrefix
   * hit across the 5 bundle calls. segmentInstruction carries the
   * `\n\n---\n` separator so concatenation stays byte-identical with the
   * pre-split build() output.
   */
  async buildSegmented(context: EngineContext): Promise<{ sharedPrefix: string; segmentInstruction: string }> {
    const validPersona = isValidPersona(context.persona) ? (context.persona as PersonaId) : 'creator';

    const promptOverride = (await this.promptConfig?.resolvePromptTemplate()) ?? UCIS_V5_4_SYSTEM;

    const basePrompt = await getUCISPrompt({
      promptOverride,
      metadata: {
        title: context.metadata.title,
        channelTitle: context.metadata.channelTitle,
        viewCount: String(context.metadata.viewCount ?? ''),
        likeCount: String(context.metadata.likeCount ?? ''),
        commentCount: String(context.metadata.commentCount ?? ''),
        publishedAt: context.metadata.publishedAt,
        subscriberCount: context.metadata.subscriberCount,
        channelVideoCount: context.metadata.channelVideoCount,
        channelPublishedAt: context.metadata.channelPublishedAt,
      },
      transcript: context.transcript || '',
      persona: validPersona,
      timezone: context.timezone || 'UTC',
      duration: context.metadata.duration || 0,
      skipAllDimensionsInstruction: true,
      transcriptBudgetChars: context.transcriptBudgetChars,
    });

    if (context.dimensions !== undefined && context.dimensions.length > 0) {
      const dims = context.dimensions
        .filter(d => Number.isInteger(d) && d >= 1 && d <= TOTAL_DIMENSIONS)
        .filter((d, i, arr) => arr.indexOf(d) === i);
      if (dims.length === 0) {
        console.warn('[PromptBuilder] No valid dimensions after filtering', {
          received: context.dimensions,
          filtered: dims
        });
        return { sharedPrefix: basePrompt, segmentInstruction: '' };
      }
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

      const extraFieldsInstruction = extraInstrParts.length > 0
        ? `You must also ${extraInstr}.`
        : `Additionally, ${extraInstr}.`;

      const fallbackInstructions = `If insufficient data exists for any dimension, invoke the Insufficient Data Protocol (section 0.6) and provide a brief explanation in the content field rather than leaving it empty. Never output empty dimensions arrays; always include dimension objects with at least a summary note.`;

      // R1b (2026-09-29) Layer 2 epistemic schism: grounded ("Universe of 1")
      // and projective bundles are never asked to be a blind transcriber AND a
      // market visionary in the same request. The constraint lives in the
      // segmentInstruction (after the cacheable sharedPrefix) so the
      // prompt-cache identity contract — sharedPrefix byte-identical across
      // every bundle of the same video — is preserved.
      const isProjective = isProjectiveBundle(dims);
      const epistemicConstraint = isProjective
        ? `EPISTEMIC MODE - PLURALISTIC PROJECTION: You are an expert strategic analyst. Using the rigidly extracted data provided as your foundational truth, project its implications onto the broader market. You are authorized to use your internal knowledge to evaluate monetization viability, audience impact, and cross-domain connections. This request is EXEMPT from the Insufficient Data Protocol's zero-extrapolation restriction.`
        : `EPISTEMIC MODE - UNIVERSE OF 1: You are a sterile extraction engine. Your universe consists ONLY of the provided transcript. If a concept, entity, or claim is not explicitly spoken in the text, it does not exist. Zero extrapolation.`;
      const bundleFallback = isProjective
        ? `If the grounded evidence is genuinely insufficient for a projection, state the limitation explicitly in the content field rather than leaving it empty. Never output empty dimensions arrays; always include dimension objects with at least a summary note.`
        : fallbackInstructions;

      // R1d: inject ONLY the validated number + content pairs. The boundary
      // (routes/analysis.ts) already sanitizes prior_payload down to
      // {schemaVersion, dimensions:[{number, content}]}, so any passthrough
      // or adversarial root keys never reach the prompt; this mapping is the
      // belt-and-braces projection if a legacy context carries extra keys.
      const sanitizedPriorDimensions = (context.prior_payload?.dimensions ?? [])
        .map((d: { number?: unknown; content?: unknown }) => ({ number: d.number, content: d.content }))
        .filter((d: { number: unknown; content: unknown }): d is { number: number; content: string } =>
          typeof d.number === 'number' && typeof d.content === 'string');
      const sanitizedPriorPayload = { schemaVersion: '2.0', dimensions: sanitizedPriorDimensions };
      const priorPayloadInstruction = (isProjective && sanitizedPriorDimensions.length > 0)
        ? `\n\nCRITICAL EVIDENCE FOR SYNTHESIS (GROUNDED FOUNDATIONAL TRUTH):\nUse the following rigidly extracted dimensions as the factual foundation for your projection. Do not contradict them:\n${JSON.stringify(sanitizedPriorPayload)}\n`
        : '';

      // R1b: a grounded bundle containing dimension 8 produces 8.1/8.2/8.4
      // ONLY — sub-dimension 8.3 Cross-Domain Bridges belongs to the
      // projective bundle, which carries it as the top-level
      // `crossDomainBridges` root field and which is stitched back into
      // dimension 8's content client-side.
      const dim8GroundedOmission = (!isProjective && dims.includes(8))
        ? `\nIMPORTANT: For DIMENSION 8, produce ONLY sub-sections 8.1, 8.2, and 8.4. Do NOT include the "Cross-Domain Bridges" sub-section (8.3) anywhere in your output.\n`
        : '';

      // R1b: the projective bundle ALWAYS owns sub-dimension 8.3 Cross-Domain
      // Bridges, carried as the top-level `crossDomainBridges` root field —
      // independent of which dimension extraFields happen to be in play.
      const projectiveBridgeInstruction = isProjective
        ? ` You must also generate and include the "crossDomainBridges" markdown string in the JSON root (your sub-dimension 8.3 Cross-Domain Bridges section: at least 2 bridges connecting the video's core ideas to adjacent domains, formatted as markdown under the heading "#### 8.3 Cross-Domain Bridges"). Do NOT emit a dimension-8 object.`
        : '';

      return {
        sharedPrefix: basePrompt,
        segmentInstruction: `

---
${epistemicConstraint}
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (${label}):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimension(s):
${dimLabels}
${priorPayloadInstruction}${dim8GroundedOmission}
Your output JSON object must ONLY include these dimension(s) inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0". ${extraFieldsInstruction}${projectiveBridgeInstruction}
Your response must enforce a strict maximum output restriction of 400 analytical words per dimension.
${bundleFallback}
Do NOT output any other dimensions. Do NOT include any other JSON root fields${isProjective ? ' besides "crossDomainBridges"' : ''}. Your response must be strict, raw JSON without markdown formatting. Ensure that your output strictly matches this layout.`,
      };
    }

    return { sharedPrefix: basePrompt, segmentInstruction: '' };
  }
}
