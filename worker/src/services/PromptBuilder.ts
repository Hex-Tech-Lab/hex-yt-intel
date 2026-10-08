import { getUCISPrompt } from '../../../web/lib/prompts/factory';
import { UCIS_V5_4_SYSTEM } from '../../../web/lib/prompts/ucis-v5.4';
import { DIMENSION_CONFIGS, TOTAL_DIMENSIONS, isProjectiveBundle } from '../../../web/lib/config/synthesis';
import { isValidPersona } from '../../../web/lib/types/persona';
import type { PromptBuilderPort } from '../ports/PromptBuilderPort';
import type { PromptConfigPort } from '../ports/PromptConfigPort';
import type { EngineContext } from '../ports/ReasoningEnginePort';
import type { PersonaId } from '../../../web/lib/types/persona';

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
/**
 * Builds LLM prompts for the analysis pipeline (UCIS v5.4 shared prefix,
 * segmented-dimension instructions, and the ADR 039 Part A/B prompts).
 */
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
        .filter((dimNumber) => Number.isInteger(dimNumber) && dimNumber >= 1 && dimNumber <= TOTAL_DIMENSIONS)
        .filter((dimNumber, i, arr) => arr.indexOf(dimNumber) === i);
      if (dims.length === 0) {
        console.warn('[PromptBuilder] No valid dimensions after filtering', {
          received: context.dimensions,
          filtered: dims
        });
        return { sharedPrefix: basePrompt, segmentInstruction: '' };
      }
      const allExtraFields = new Set<string>();
      const extraInstrParts: string[] = [];
      for (const dimNumber of dims) {
        const cfg = DIMENSION_CONFIGS[dimNumber];
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

      const dimLabels = dims.map((dimNumber) => {
        const cfg = DIMENSION_CONFIGS[dimNumber];
        return cfg ? `- ### DIMENSION ${dimNumber} - ${cfg.name}` : `- ### DIMENSION ${dimNumber}`;
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
        ? `EPISTEMIC MODE - PLURALISTIC PROJECTION: You are an expert strategic analyst. Using the rigidly extracted data provided as your foundational truth, project its implications onto the broader market. You are authorized to use your internal knowledge to evaluate monetization viability, audience impact, and cross-domain connections. This request is EXEMPT from the Insufficient Data Protocol's zero-extrapolation restriction. You are strictly FORBIDDEN from using the literal string "[Insufficient data in source transcript to fulfill this dimension]" across any persona archetype (Creator, Indie Maker, Consultant, Researcher, Product Manager). If direct evidence is minimal, generate realistic deductive market projections and strategic estimations based on domain dynamics.`
        : `EPISTEMIC MODE - UNIVERSE OF 1: You are a sterile extraction engine. Your universe consists ONLY of the provided transcript. If a concept, entity, or claim is not explicitly spoken in the text, it does not exist. Zero extrapolation.`;
      const bundleFallback = isProjective
        ? `Never output "[Insufficient data in source transcript to fulfill this dimension]". If direct evidence is sparse, provide a deductive market projection and strategic estimation. Never output empty dimensions arrays; always include dimension objects with analytical projections.`
        : fallbackInstructions;

      // R1d: inject ONLY the validated number + content pairs. The boundary
      // (routes/analysis.ts) already sanitizes prior_payload down to
      // {schemaVersion, dimensions:[{number, content}]}, so any passthrough
      // or adversarial root keys never reach the prompt; this mapping is the
      // belt-and-braces projection if a legacy context carries extra keys.
      const rawPriorDimensions: unknown = context.prior_payload?.dimensions;
      const sanitizedPriorDimensions = (Array.isArray(rawPriorDimensions) ? rawPriorDimensions : [])
        .map((dim: { number?: unknown; content?: unknown }) => ({ number: dim.number, content: dim.content }))
        .filter((dim: { number: unknown; content: unknown }): dim is { number: number; content: string } =>
          typeof dim.number === 'number' && typeof dim.content === 'string');
      const sanitizedPriorPayload = { schemaVersion: '2.0', dimensions: sanitizedPriorDimensions };
      const priorPayloadInstruction = (isProjective && sanitizedPriorDimensions.length > 0)
        ? `\n\nCRITICAL EVIDENCE FOR SYNTHESIS (GROUNDED FOUNDATIONAL TRUTH):\nUse the following rigidly extracted dimensions as the factual foundation for your projection. Do not contradict them:\n${JSON.stringify(sanitizedPriorPayload)}\n`
        : '';

      const dim6Notice = dims.includes(6)
        ? (isProjective
          ? `\nIMPORTANT: For DIMENSION 6, insert an upfront notice banner at "#### 6.0 Comparative Scope & Stress-Testing" explaining comparative parameters, stress-testing boundaries, and deductive projection models before 6.1 and 6.2.\n`
          : `\nIMPORTANT: For DIMENSION 6, insert an upfront notice banner at "#### 6.0 Comparative Scope & Stress-Testing" explaining the comparative parameters and stress-testing boundaries applied to this dimension before 6.1 and 6.2. Scope the comparison strictly to what the transcript evidences.\n`)
        : '';

      // R1b/R1e: a grounded bundle containing dimension 8 produces 8.1/8.2
      // ONLY — sub-dimensions 8.3 Cross-Domain Bridges and 8.4 Discovery
      // Pathways belong to the projective bundle (8.3 as `crossDomainBridges`,
      // 8.4 as `discoveryPathways`), stitched back into dimension 8's content
      // client-side. The grounded pass instead emits the intermediate root
      // array `explicitSpeakerResources` (max 20 items) — the "explicitly
      // named" input the projective 8.4 needs.
      const dim8GroundedOmission = (!isProjective && dims.includes(8))
        ? `\nIMPORTANT: For DIMENSION 8, produce ONLY sub-sections 8.1 and 8.2. Do NOT include the "Cross-Domain Bridges" sub-section (8.3) and do NOT include a "Discovery Pathways" sub-section (8.4) anywhere in your output. Instead, you must also generate and include the "explicitSpeakerResources" string array in the JSON root: resources, tools, or further reading the speaker EXPLICITLY names in the transcript (verbatim-ish, maximum 20 items; use an empty array if none).\n`
        : '';

      // R1b/R1e: the projective bundle ALWAYS owns sub-dimension 8.3 Cross-
      // Domain Bridges (as `crossDomainBridges`) and sub-dimension 8.4
      // Discovery Pathways (as `discoveryPathways`), both carried as top-level
      // root fields — independent of which dimension extraFields happen to be
      // in play.
      const projectiveBridgeInstruction = isProjective
        ? ` You must also generate and include the "crossDomainBridges" markdown string in the JSON root (your sub-dimension 8.3 Cross-Domain Bridges section: at least 2 bridges connecting the video's core ideas to adjacent domains, formatted as markdown under the heading "#### 8.3 Cross-Domain Bridges"). You must also generate and include the "discoveryPathways" markdown string in the JSON root (your sub-dimension 8.4 Discovery Pathways section, written per the "#### 8.4 Discovery Pathways" instructions in the framework, using the explicitly-named resources listed in the prior payload where applicable, formatted as markdown under the heading "#### 8.4 Discovery Pathways"). Do NOT emit a dimension-8 object.`
        : '';

      return {
        sharedPrefix: basePrompt,
        segmentInstruction: `

---
${epistemicConstraint}
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (${label}):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimension(s):
${dimLabels}
${priorPayloadInstruction}${dim8GroundedOmission}${dim6Notice}
Your output JSON object must ONLY include these dimension(s) inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0". ${extraFieldsInstruction}${projectiveBridgeInstruction}
Your response must enforce a strict maximum output restriction of 400 analytical words per dimension.
${bundleFallback}
Do NOT output any other dimensions. Do NOT include any other JSON root fields${isProjective ? ' besides "crossDomainBridges" and "discoveryPathways"' : `${dims.includes(8) ? ' besides "explicitSpeakerResources"' : ''}`}. Your response must be strict, raw JSON without markdown formatting. Ensure that your output strictly matches this layout.`,
      };
    }

    return { sharedPrefix: basePrompt, segmentInstruction: '' };
  }

  /**
   * Part A (ADR 039) prompt: sterile transcript-only extraction with a strict
   * claims/unknowns/metadata JSON schema.
   */
  buildGroundedExtractionPrompt(
    transcriptChunks: Array<{ text: string; start: number; end: number; speaker?: string }>,
    metadata: {
      title?: string;
      speakerCount: number;
      durationSeconds: number;
      classification: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
    },
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a sterile extraction engine. Your universe consists ONLY of the provided transcript. If it is not explicitly spoken, it does not exist. Zero extrapolation. You must output the requested JSON schema using exact timestamps. If evidence for a required dimension is missing, place the dimension key in the unknowns array.

Output format must be valid, raw JSON conforming strictly to this layout:
{
  "claims": [
    {
      "id": "claim_01",
      "speaker": "Speaker Name or optional identifier",
      "timestampRange": [125, 140],
      "verbatimQuote": "exact quote from transcript",
      "atomicAssertion": "concise factual assertion made in the quote",
      "confidence": 1.0
    }
  ],
  "unknowns": ["explicit missing items or dimensions without direct evidence"],
  "metadata": {
    "speakerCount": ${metadata.speakerCount},
    "durationSeconds": ${metadata.durationSeconds},
    "classification": "${metadata.classification}"
  }
}

Do NOT output markdown blocks or surrounding text. Emit strictly parseable JSON.`;

    const formattedTranscript = transcriptChunks
      .map(
        (chunk, idx) =>
          `[${idx}] [${chunk.start.toFixed(1)}s - ${chunk.end.toFixed(1)}s]${chunk.speaker ? ` ${chunk.speaker}:` : ''} ${chunk.text}`,
      )
      .join('\n');

    const userPrompt = `Video Metadata:
Title: ${metadata.title || 'Unknown Title'}
Duration: ${metadata.durationSeconds}s
Classification: ${metadata.classification}

Transcript Segments:
${formattedTranscript}

Extract all verifiable atomic claims with exact timestamp ranges and verbatim quotes. Output the JSON payload:`;

    return { systemPrompt, userPrompt };
  }

  /**
   * Part B (ADR 039) prompt: projective synthesis over the grounded payload
   * with mandatory claim-ID citations.
   */
  buildProjectiveSynthesisPrompt(
    payload: import('../types/grounded-extraction').GroundedExtractionPayload,
    persona?: string,
  ): { systemPrompt: string; userPrompt: string } {
    const systemPrompt = `You are a strategic intelligence analyst performing projective synthesis.
You operate EXCLUSIVELY over the provided Grounded Claims JSON payload.
You DO NOT have access to the raw transcript, and you must NOT speculate beyond the provided evidence.

CRITICAL CITATION CONSTRAINT:
Every strategic assertion, market projection, and implication you produce MUST explicitly cite one or more source Claim IDs from the payload (e.g., "[claim_01]", "[claim_04]").
Assertions that fail to cite a Grounded Claim ID are strictly prohibited.

Output format must be valid, raw JSON conforming to this layout:
{
  "schemaVersion": "2.0",
  "persona": "${persona || 'creator'}",
  "synthesis": {
    "coreThesis": "Strategic thesis statement explicitly citing [claim_xx]",
    "projections": [
      {
        "id": "proj_01",
        "citedClaimIds": ["claim_01"],
        "implication": "Strategic forward-looking projection",
        "marketHorizon": "near-term",
        "confidence": 0.9
      }
    ],
    "unsupportedQuestions": []
  }
}

Do NOT output markdown code blocks or explanatory text. Emit strictly parseable JSON.`;

    const userPrompt = `Grounded Claims Payload:
${JSON.stringify(payload, null, 2)}

Perform projective synthesis and strategic analysis. Ensure every projection explicitly cites the source Claim IDs:`;

    return { systemPrompt, userPrompt };
  }
}
