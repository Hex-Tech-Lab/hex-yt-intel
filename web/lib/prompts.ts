import { UCIS_V5_SYSTEM } from './prompts/ucis-v5';

export type PersonaId = 'p1' | 'p2' | 'p3' | 'p4' | 'p5';

export interface PersonaConfiguration {
  personaId: PersonaId;
  name: string;
  weight: number;
}

const PERSONA_REGISTRY: Record<PersonaId, string> = {
  p1: 'Content Creator',
  p2: 'Indie Maker',
  p3: 'Consultant',
  p4: 'Researcher',
  p5: 'Product Manager',
};

/**
 * Persona auto-detection using domain-signal keywords
 * Falls back to p1 (Content Creator) if no match
 */
export function detectPersona(title: string, author: string): PersonaId {
  const text = `${title} ${author}`.toLowerCase();

  // Keyword patterns per persona (domain signals)
  const patterns: Record<PersonaId, RegExp> = {
    p1: /content|creator|youtube|video|channel|viral|engagement|audience|subscriber|hack|growth|algorithm/,
    p2: /startup|founder|saas|indiehacker|bootstrap|mrr|product-market|validation|launch|indie|maker/,
    p3: /strategy|framework|consulting|business|advisory|implementation|process|management|case-study/,
    p4: /research|study|scientific|academic|analysis|data|methodology|evidence|literature|peer-reviewed|experiment|hypothesis/,
    p5: /product|roadmap|prioriti(?:es|zation)?|feature|user|customer|requirements|design|ux|pm/,
  };

  for (const [persona, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) {
      return persona as PersonaId;
    }
  }

  // Default fallback
  return 'p1';
}

/**
 * Persona ranking based on detected primary
 * Returns weighted secondary/tertiary personas
 */
export function rankPersonas(primary: PersonaId): PersonaConfiguration[] {
  const allPersonas: PersonaId[] = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const ordered: PersonaId[] = [primary, ...allPersonas.filter((p) => p !== primary)];

  return [
    { personaId: ordered[0]!, name: PERSONA_REGISTRY[ordered[0]!], weight: 50 },
    { personaId: ordered[1]!, name: PERSONA_REGISTRY[ordered[1]!], weight: 25 },
    { personaId: ordered[2]!, name: PERSONA_REGISTRY[ordered[2]!], weight: 15 },
    { personaId: ordered[3]!, name: PERSONA_REGISTRY[ordered[3]!], weight: 5 },
    { personaId: ordered[4]!, name: PERSONA_REGISTRY[ordered[4]!], weight: 5 },
  ];
}

export const UCIS_V3_2_SYSTEM = `You are an expert YouTube content analyst using the Ultimate Content Intelligence System v3.2.

Analyze the provided YouTube video transcript and metadata to generate a comprehensive content intelligence report.

Structure your response as a detailed markdown document with these 16 sections:

1. **Executive Summary** - Single paragraph distilling key insights (100 words max)
2. **Video Metadata** - Title, channel, publish date, duration, view count, engagement metrics
3. **Content Classification** - Genre, category, target audience, content type
4. **Key Topics** - Main themes, subjects covered, knowledge areas
5. **Audience Engagement Metrics** - View trends, like/comment ratio, predicted retention patterns
6. **Content Structure** - Breakdown of segments, pacing, flow analysis
7. **Educational Value** - Learning outcomes, practical takeaways, skill development potential
8. **Emotional Arc** - Tone progression, audience sentiment drivers, engagement hooks
9. **Technical Quality** - Audio/video production assessment, presentation effectiveness
10. **Unique Value Proposition** - What makes this content unique, competitive advantages
11. **Monetization Potential** - Sponsorship opportunities, affiliate potential, audience size assessment
12. **SEO & Discovery** - Title optimization, keyword coverage, discoverability score
13. **Actionable Insights** - Top 3-5 concrete takeaways for viewers
14. **Risk Disclosure** - Any health, financial, legal disclaimers (if applicable)
15. **Similar Content References** - Related videos or creators in the same niche
16. **Intelligence Implementation** - Specific next steps for viewer/creator implementation

Be concise but thorough. Use markdown formatting. Include data points where available.`;

export function createUCISPrompt(metadata: {
  title: string;
  channelTitle: string;
  viewCount: string;
  likeCount: string;
  commentCount: string;
  publishedAt: string;
}, transcript: string): string {
  return `Analyze this YouTube video using UCIS v3.2:

**Video:** ${metadata.title}
**Channel:** ${metadata.channelTitle}
**Views:** ${metadata.viewCount} | **Likes:** ${metadata.likeCount} | **Comments:** ${metadata.commentCount}
**Published:** ${metadata.publishedAt}

**Transcript:**
${transcript.slice(0, 15000)}${transcript.length > 15000 ? '\n[...transcript truncated...]' : ''}

Generate the 16-section Intelligence Report.`;
}

/**
 * UCIS v5.0 prompt factory
 * Injects metadata blob, persona configuration, and system prompt
 * Includes short-form content detection to prevent hallucination on Shorts
 */
export function createUCISV5Prompt(params: {
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
  duration?: number; // Duration in seconds; if < 180s, inject short-form notice
}): string {
  const personas = rankPersonas(params.persona);
  const metadataJson = JSON.stringify(params.metadata, null, 2);

  // Short-form detection: inject notice if video is < 3 minutes (180 seconds)
  const isShortForm = params.duration !== undefined && params.duration < 180;
  const shortFormNotice = isShortForm
    ? `\n**SHORT-FORM CONTENT NOTICE**: This is a short-form video (${Math.round(params.duration! / 60)}m ${params.duration! % 60}s). Output a highly condensed report. Skip complex matrices, scenario stress-testing, and deep temporal mapping unless explicitly supported by the transcript. Invoke the Insufficient Data Protocol (section 0.6) liberally if depth is unavailable.`
    : '';

  return `${UCIS_V5_SYSTEM}

---

## ACTIVE ANALYSIS SESSION

**Metadata JSON Blob** (for Pre-Analysis Protocol Step 1):
\`\`\`json
${metadataJson}
\`\`\`

**Persona Configuration**:
${personas.map((p) => `- ${p.personaId.toUpperCase()}: ${p.name} (Weight: ${p.weight}%)`).join('\n')}

**Timezone**: ${params.timezone}${shortFormNotice}

**Transcript**:
${params.transcript.slice(0, 20000)}${params.transcript.length > 20000 ? '\n\n[...transcript truncated to 20K characters...]' : ''}

---

**Execution**: Generate the complete v5.0 analysis output using the framework above. All 10 dimensions must be present. Satisfy the quality enforcement checklist before delivering output. Remember: Transcript Absolutism (section 0.5) and the Insufficient Data Protocol (section 0.6) override all other instructions.`;
}
