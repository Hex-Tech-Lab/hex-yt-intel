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
export const EXECUTIVE_DIGEST_SYSTEM = `You are a precision executive-summarizer. Your only input is a completed 11-dimension intelligence analysis of a single YouTube video. Produce a three-tier executive digest OF THAT ANALYSIS. You are compressing already-distilled material — surface the signal, invent nothing.

HARD RULES
- Synthesize ONLY from the provided analysis. Introduce no facts, numbers, names, dates, or claims that are not present in it.
- No preamble, no meta ("In this summary…"), and no headings beyond the three specified below.
- Neutral, information-dense, plain language. Cut hedging and filler.
- If forced to drop something, keep the single most consequential takeaway.
- Never mention "dimensions", "the analysis", or the pipeline — write about the VIDEO'S CONTENT.

OUTPUT — emit exactly these three sections, in order, and nothing else:

#### 0.1 Snapshot
One paragraph, 3–5 lines. What the video is, its core thesis, and why it matters — for someone who will never watch it. This tier alone must convey the gist.

#### 0.2 Key Takeaways
Up to 10 bullets ("- " each), ranked most→least important. Each ≤ 20 words, one concrete idea, no sub-bullets. Prefer specifics (a tactic, a number, a claim) over generalities.

#### 0.3 Overview
3–5 paragraphs. The full arc: context → main arguments & evidence → conclusions / implications. Faithful to the source's structure and emphasis; add no new interpretation.`;

/**
 * Build the user message for the digest pass from the assembled analysis
 * markdown (the stitched 11-dimension output).
 */
export function buildExecutiveDigestUserMessage(analysisMarkdown: string): string {
  return `Here is the completed 11-dimension analysis to digest:\n\n${analysisMarkdown.trim()}`;
}

export interface ExecutiveDigest {
  /** Tier 1 — one short paragraph. */
  snapshot: string;
  /** Tier 2 — ranked bullets (leading "- " markers stripped). */
  takeaways: string[];
  /** Tier 3 — multi-paragraph overview. */
  overview: string;
}

const DIGEST_HEADERS: Array<{ key: keyof ExecutiveDigest; re: RegExp }> = [
  { key: 'snapshot', re: /^####\s*0\.1\b[^\n]*/im },
  { key: 'takeaways', re: /^####\s*0\.2\b[^\n]*/im },
  { key: 'overview', re: /^####\s*0\.3\b[^\n]*/im },
];

/**
 * Parse the three `#### 0.x` tiers out of a digest completion. Returns null if
 * none of the tiers are present (so callers can treat the digest as absent
 * rather than render an empty card). Tolerant of a leading ```-fence and of the
 * model omitting one tier.
 */
export function parseExecutiveDigest(raw: string | null | undefined): ExecutiveDigest | null {
  if (!raw || !raw.trim()) return null;

  let md = raw.trim();
  if (md.startsWith('```')) {
    md = md.replace(/^```[a-zA-Z0-9]*[ \t]*\r?\n/, '').replace(/\r?\n?```[ \t\r\n]*$/, '').trim();
  }

  // Locate each header; slice content up to the next present header.
  const found = DIGEST_HEADERS
    .map(({ key, re }) => {
      const m = re.exec(md);
      return m ? { key, start: m.index, headerLen: m[0].length } : null;
    })
    .filter((x): x is { key: keyof ExecutiveDigest; start: number; headerLen: number } => x !== null)
    .sort((a, b) => a.start - b.start);

  if (found.length === 0) return null;

  const sections: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]!;
    const contentStart = cur.start + cur.headerLen;
    const contentEnd = found[i + 1]?.start ?? md.length;
    sections[cur.key] = md.slice(contentStart, contentEnd).trim();
  }

  const takeawaysBlock = sections.takeaways ?? '';
  const takeaways = takeawaysBlock
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
    .filter((l) => l.length > 0);

  return {
    snapshot: sections.snapshot ?? '',
    takeaways,
    overview: sections.overview ?? '',
  };
}
