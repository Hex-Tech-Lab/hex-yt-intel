/**
 * Dimension 0 — Executive Digest (three-tier summary).
 *
 * A single, cheap post-synthesis pass: once all 11 dimensions have been
 * generated and assembled, one completion turns that already-condensed
 * material into a three-tier digest (snapshot / key takeaways / overview).
 * It is NOT a second analysis — the input is the compact 11-dimension output,
 * the output is short — so it runs on the cheapest cascade model at marginal
 * cost. It is uncounted: never a 12th UCIS "dimension", so nothing that keys
 * off the 1..11 range (dimension_count, completeness status, the reaper) is
 * affected.
 *
 * The wiring (route + trigger + render) imports this module; keeping the prompt
 * and the tier parser here makes the contract versioned and unit-testable.
 */

/** Strict system prompt for the digest pass. */
export const EXECUTIVE_DIGEST_SYSTEM = `You are a precision executive-summarizer. Your only input is a completed 11-dimension intelligence analysis of a single YouTube video. Produce a four-tier executive digest OF THAT ANALYSIS. You are compressing already-distilled material — surface the signal, invent nothing.

HARD RULES
- Synthesize ONLY from the provided analysis. Introduce no facts, numbers, names, dates, or claims that are not present in it.
- No preamble, no meta ("In this summary…"), and no headings beyond the four specified below.
- Neutral, information-dense, plain language. Cut hedging and filler.
- If forced to drop something, keep the single most consequential takeaway.
- Never mention "dimensions", "the analysis", or the pipeline — write about the VIDEO'S CONTENT.

OUTPUT — emit exactly these four sections, in order, and nothing else:

#### 0.1 Snapshot
One paragraph, 3–5 lines. What the video is, its core thesis, and why it matters — for someone who will never watch it. This tier alone must convey the gist.

#### 0.2 Overview
1–2 paragraphs. A quick high-level summary of the main points. It sits between the one-liner snapshot and the key takeaways.

#### 0.3 Key Takeaways
Up to 10 bullets ("- " each), ranked most→least important. Each ≤ 20 words, one concrete idea, no sub-bullets. Prefer specifics (a tactic, a number, a claim) over generalities. Assess the content and use fewer than 10 bullets if appropriate to avoid unnecessary crowding.

#### 0.4 Detailed Summary
3–5 paragraphs. The full arc: context → main arguments & evidence → conclusions / implications. Faithful to the source's structure and emphasis; add no new interpretation.`;

export function truncateForDigest(markdown: string, maxChars = 18000): string {
  if (!markdown) return '';
  if (markdown.length <= maxChars) return markdown.trim();
  const dimRegex = /##+\s*Dimension\s+\d+[\s\S]*?(?=##+\s*Dimension\s+\d+|$)/gi;
  const dims = markdown.match(dimRegex) || [];
  const priorityNums = [1, 3, 5, 11];
  const priority: string[] = [];
  const rest: string[] = [];
  for (const d of dims) {
    const numMatch = d.match(/Dimension\s+(\d+)/i);
    const num = numMatch ? parseInt(numMatch[1]!, 10) : -1;
    if (priorityNums.includes(num)) priority.push(d);
    else rest.push(d);
  }
  let out = (priority.length > 0 ? priority : dims.slice(0, 4)).join('\n\n').slice(0, maxChars);
  if (out.length < 5000 && dims.length > 0) {
    out = dims.join('\n\n').slice(0, maxChars);
  }
  if (out.trim().length === 0) return markdown.slice(0, maxChars).trim();
  return out.trim();
}

/**
 * Build the user message for the digest pass from the assembled analysis
 * markdown (the stitched 11-dimension output).
 */
export function buildExecutiveDigestUserMessage(analysisMarkdown: string): string {
  const safe = truncateForDigest(analysisMarkdown, 18000);
  return `Here is the completed 11-dimension analysis to digest:\n\n${safe.trim()}`;
}

export interface ExecutiveDigest {
  /** Tier 1 — one short paragraph. */
  snapshot: string;
  /** Tier 2 — ranked bullets (leading "- " markers stripped). */
  takeaways: string[];
  /** Tier 3 — 1-2 paragraph overview. */
  overview: string;
  /** Tier 4 — multi-paragraph detailed summary. */
  detailedSummary: string;
  /** How the digest was parsed — headers matched or fallback heuristics. */
  parsedVia?: 'headers' | 'fallback';
}

interface TierLocation {
  key: keyof ExecutiveDigest;
  start: number;
  headerLen: number;
}

const DIGEST_HEADERS: Array<{ key: keyof ExecutiveDigest; headerRe: RegExp }> = [
  { key: 'snapshot', headerRe: /(?:^|\n)\s*(?:####\s*0\.1\b[^\n]*|(?:snapshot|ملخص\s*سريع|لمحة)\s*[:\n])/imu },
  { key: 'overview', headerRe: /(?:^|\n)\s*(?:####\s*0\.2\b[^\n]*|(?:overview|نظرة\s*عامة|ملخص\s*عام)\s*[:\n])/imu },
  { key: 'takeaways', headerRe: /(?:^|\n)\s*(?:####\s*0\.3\b[^\n]*|(?:key\s*takeaways|takeaways|الاستنتاجات|نقاط\s*رئيسية)\s*[:\n])/imu },
  { key: 'detailedSummary', headerRe: /(?:^|\n)\s*(?:####\s*0\.4\b[^\n]*|(?:detailed\s*summary|تفصيلي|تفاصيل|ملخص\s*مفصل)\s*[:\n])/imu },
];

/**
 * Recursively strip leading whitespace and bullet markers (`- `, `* `, `• `).
 * Handles sub-bullet leakage: "  - - nested item" → "nested item".
 */
function stripBullets(line: string): string {
  let stripped = line.replace(/^\s+/u, '');
  while (stripped.startsWith('- ') || stripped.startsWith('* ') || stripped.startsWith('• ')) {
    stripped = stripped.slice(2).trimStart();
  }
  return stripped;
}

/**
 * Parse the four `#### 0.x` tiers out of a digest completion. Returns null if
 * none of the tiers are present (so callers can treat the digest as absent
 * rather than render an empty card). Tolerant of a leading ```-fence and of the
 * model omitting one tier.
 */
export function parseExecutiveDigest(raw: string | null | undefined): ExecutiveDigest | null {
  if (!raw || !raw.trim()) return null;

  let markdown = raw.trim();
  if (markdown.startsWith('```')) {
    markdown = markdown
      .replace(/^```[a-zA-Z0-9]*[ \t]*\r?\n/u, '')
      .replace(/\r?\n?```[ \t\r\n]*$/u, '')
      .trim();
  }

  // Locate each present header, then slice content up to the next one.
  const located: TierLocation[] = [];
  for (const { key, headerRe } of DIGEST_HEADERS) {
    const match = markdown.match(headerRe);
    if (match && match.index !== undefined) {
      located.push({ key, start: match.index, headerLen: match[0].length });
    }
  }
  if (located.length === 0) {
    const fallback = markdown.trim();
    if (fallback.length < 20) return null;

    // Reject refusal patterns: model explicitly declined to produce content.
    if (/^.{0,200}(?:sorry|i\s+cannot|as\s+an\s+ai|unable\s+to\s+comply)/ims.test(fallback)) {
      return null;
    }

    // Reject near-empty content: fewer than 3 non-empty lines.
    const nonEmptyLines = fallback.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (nonEmptyLines.length < 3) return null;

    const lines = fallback.split(/\r?\n/).filter(l => l.trim().length > 0);

    const rawTakeaways = lines
      .filter(l => {
        const trimmed = l.replace(/^\s+/u, '');
        return trimmed.startsWith('-') || trimmed.startsWith('•');
      })
      .slice(0, 10)
      .map(stripBullets);

    // Fallback: if no bullet lines found, use first 3-5 non-empty lines as takeaways
    const takeaways = rawTakeaways.length > 0 ? rawTakeaways : lines.slice(0, 5).map(stripBullets);

    return {
      snapshot: lines.slice(0, 2).join(' ').slice(0, 500),
      takeaways,
      overview: lines.slice(2, 8).join('\n'),
      detailedSummary: fallback.slice(0, 2000),
      parsedVia: 'fallback',
    };
  }
  located.sort((a, b) => a.start - b.start);

  const sections: Partial<Record<keyof ExecutiveDigest, string>> = {};
  located.forEach((entry, index) => {
    const contentStart = entry.start + entry.headerLen;
    const contentEnd = located[index + 1]?.start ?? markdown.length;
    sections[entry.key] = markdown.slice(contentStart, contentEnd).trim();
  });

  const takeaways = (sections.takeaways ?? '')
    .split(/\r?\n/u)
    .map(stripBullets)
    .filter((line) => line.length > 0);

  return {
    snapshot: sections.snapshot ?? markdown.slice(0, 500),
    takeaways: takeaways.length > 0 ? takeaways : markdown.split('\n').filter(l => l.trim().length > 0).slice(0, 5),
    overview: sections.overview ?? markdown.slice(0, 1000),
    detailedSummary: sections.detailedSummary ?? markdown.slice(0, 2000),
    parsedVia: 'headers',
  };
}
