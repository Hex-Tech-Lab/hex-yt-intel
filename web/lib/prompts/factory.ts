import type { PersonaId } from '@/lib/prompts';
import { rankPersonas } from '@/lib/prompts';
import { resolveUCISPromptTemplate } from '../services/settings';

type UCISVersion = '5.0' | '5.1';

export interface GetUCISPromptParams {
  version: UCISVersion;
  metadata: {
    title: string;
    channelTitle: string;
    viewCount: string;
    likeCount: string;
    commentCount: string;
    publishedAt: string;
  };
  transcript: string;
  persona: PersonaId;
  timezone: string;
  duration?: number;
}

/**
 * Centralized UCIS prompt factory
 * Dynamically switches between prompt versions and injects metadata/persona context
 */
export async function getUCISPrompt({
  version,
  metadata,
  transcript,
  persona,
  timezone,
  duration,
}: GetUCISPromptParams): Promise<string> {
  const systemPrompt = await resolveUCISPromptTemplate(version);
  const personas = rankPersonas(persona);
  const metadataJson = JSON.stringify(metadata, null, 2);

  // Short-form detection: inject notice if video is < 3 minutes (180 seconds)
  const isShortForm = duration !== undefined && duration < 180;
  const shortFormNotice = isShortForm
    ? `\n**SHORT-FORM CONTENT NOTICE**: This is a short-form video (${Math.round(duration! / 60)}m ${duration! % 60}s). Output a highly condensed report. Skip complex matrices, scenario stress-testing, and deep temporal mapping unless explicitly supported by the transcript. Invoke the Insufficient Data Protocol (section 0.6) liberally if depth is unavailable.`
    : '';

  return `${systemPrompt}

---

## ACTIVE ANALYSIS SESSION

**Metadata JSON Blob** (for Pre-Analysis Protocol Step 1):
\`\`\`json
${metadataJson}
\`\`\`

**Persona Configuration**:
${personas.map((p) => `- ${p.personaId.toUpperCase()}: ${p.name} (Weight: ${p.weight}%)`).join('\n')}

**Timezone**: ${timezone}${shortFormNotice}

**Transcript**:
${transcript.slice(0, 48000)}${transcript.length > 48000 ? '\n\n[...transcript truncated to 48K characters...]' : ''}

---

**Execution**: Generate the complete v${version} analysis output using the framework above. ${version === '5.1' ? 'All 11 dimensions must be present.' : 'All 10 dimensions must be present.'} Satisfy the quality enforcement checklist before delivering output. Remember: Transcript Absolutism (section 0.5) and the Insufficient Data Protocol (section 0.6) override all other instructions.

**CRITICAL**: Do NOT include any closing tags, summary lines, or metadata markers (e.g., "End of UCIS v5.1 Report") at the end of your response. The output must end immediately after the final dimension content.`;

}
