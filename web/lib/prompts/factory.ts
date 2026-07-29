import type { PersonaId } from '@/lib/prompts';
import { rankPersonas } from '@/lib/prompts';
import { resolveUCISPromptTemplate } from '@lib/services/settings';
import { UCIS_V5_1_SYSTEM } from '@lib/prompts/ucis-v5.1';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

export interface GetUCISPromptParams {
  version?: string;
  /**
   * Pre-resolved template text, supplied by callers (e.g. the Workers
   * runtime) that can't reach resolveUCISPromptTemplate's process.env-based
   * Supabase/Redis reads. When set, resolveUCISPromptTemplate is never
   * called -- pass UCIS_V5_1_SYSTEM (or your own fallback) explicitly if
   * your live-config lookup came back empty.
   */
  promptOverride?: string;
  metadata: {
    title: string;
    channelTitle: string;
    viewCount: string;
    likeCount: string;
    commentCount: string;
    publishedAt: string;
    /** Channel-level stats (2026-07-29, UCIS v5.3) -- optional: not every
     * caller/video has these resolved (Decodo/YouTube API fetch can fail or
     * time out). When present, spread into metadataJson so Dimension
     * 2.3/11.1/11.6 can answer with real data instead of Insufficient Data. */
    subscriberCount?: number;
    channelVideoCount?: number;
    channelPublishedAt?: string;
  };
  transcript: string;
  persona: PersonaId;
  timezone: string;
  duration?: number;
  skipAllDimensionsInstruction?: boolean;
}

const formatDuration = (s?: number): string => {
  if (s === undefined || s === null || isNaN(s)) return 'Unknown';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

/**
 * Centralized UCIS prompt factory
 * Injects metadata/persona context into the resolved system prompt template
 */
export async function getUCISPrompt({
  version,
  promptOverride,
  metadata,
  transcript,
  persona,
  timezone,
  duration,
  skipAllDimensionsInstruction,
}: GetUCISPromptParams): Promise<string> {
  const systemPrompt = promptOverride ?? (await resolveUCISPromptTemplate(version));
  const personas = rankPersonas(persona);
  const formattedDuration = duration !== undefined ? formatDuration(duration) : undefined;
  const metadataWithDuration = { ...metadata, duration: formattedDuration };
  const metadataJson = JSON.stringify(metadataWithDuration, null, 2);

  // Short-form detection: inject notice if video is < 3 minutes (180 seconds)
  const isShortForm = duration !== undefined && duration < 180;
  const shortFormNotice = isShortForm
    ? `\n**SHORT-FORM CONTENT NOTICE**: This is a short-form video (${Math.round(duration! / 60)}m ${duration! % 60}s). Output a highly condensed report. Skip complex matrices, scenario stress-testing, and deep temporal mapping unless explicitly supported by the transcript. Invoke the Insufficient Data Protocol (section 0.6) liberally if depth is unavailable.`
    : '';
  const durationNotice = formattedDuration ? `\n**Video Duration**: ${formattedDuration}` : '';

  // DB-backed prompt template (not matching the legacy fallback static string)
  if (systemPrompt !== UCIS_V5_1_SYSTEM) {
    return `${systemPrompt}

---

## ACTIVE ANALYSIS SESSION

**Metadata JSON Blob**:
\`\`\`json
${metadataJson}
\`\`\`

**Persona Configuration**:
${personas.map((p) => `- ${p.personaId.toUpperCase()}: ${p.name} (Weight: ${p.weight}%)`).join('\n')}

**Timezone**: ${timezone}${durationNotice}${shortFormNotice}

**Transcript**:
${transcript.slice(0, 48000)}${transcript.length > 48000 ? '\n\n[...transcript truncated to 48K characters...]' : ''}`;
  }

  const promptVersion = version || '5.1';
  const dimensionsInstruction = skipAllDimensionsInstruction
    ? ''
    : `\n\n**Execution**: Generate the complete v${promptVersion} analysis output using the framework above. All ${TOTAL_DIMENSIONS} dimensions must be present. Satisfy the quality enforcement checklist before delivering output. Remember: Transcript Absolutism (section 0.5) and the Insufficient Data Protocol (section 0.6) override all other instructions.`;
  return `${systemPrompt}

---

## ACTIVE ANALYSIS SESSION

**Metadata JSON Blob** (for Pre-Analysis Protocol Step 1):
\`\`\`json
${metadataJson}
\`\`\`

**Persona Configuration**:
${personas.map((p) => `- ${p.personaId.toUpperCase()}: ${p.name} (Weight: ${p.weight}%)`).join('\n')}

**Timezone**: ${timezone}${durationNotice}${shortFormNotice}

**Transcript**:
${transcript.slice(0, 48000)}${transcript.length > 48000 ? '\n\n[...transcript truncated to 48K characters...]' : ''}${dimensionsInstruction}

**CRITICAL**: Do NOT include any closing tags, summary lines, or metadata markers (e.g., "End of UCIS v${promptVersion} Report") at the end of your response. The output must end immediately after the final dimension content.`;

}
