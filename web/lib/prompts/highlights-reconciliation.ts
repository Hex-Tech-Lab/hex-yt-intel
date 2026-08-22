/**
 * Highlights reconciliation (2026-08-21) — a post-extraction LLM call that
 * verifies each digest takeaway is semantically grounded by at least one
 * mapped highlight. NOT merged into the highlights extraction call:
 * different model (Haiku 4.5 vs GPT-OSS-120B), different input (structured
 * takeaways + highlights list vs full transcript), different quality bar
 * (semantic judgment, not bulk generation).
 *
 * Design: docs/agent-prompts/2026-08-21-oc-highlights-consistency-design-proposal.md §2.B.6.
 */
import type { ExtractedHighlight } from './highlights-extraction';

/** One takeaway's grounding verdict — persisted to executive_digest.reconciliation. */
export interface ReconciledTakeaway {
  idx: number;
  grounded: boolean;
  backingHighlightIdx: number | null;
}

/** The full reconciliation result — stored in executive_digest.reconciliation (jsonb). */
export interface ReconciliationResult {
  takeaways: ReconciledTakeaway[];
}

export function buildHighlightsReconciliationSystemPrompt(): string {
  return `You are a fact-checking assistant for video analysis. You are given:
1. A list of key takeaways from an executive summary of a video.
2. A list of timestamped highlights extracted from that video's transcript,
   each mapped to a takeaway index (or null if standalone — not mapped to
   any takeaway).

For each takeaway, determine whether at least one mapped highlight (one with
the same takeawayIdx) semantically supports the takeaway's claim — not just
that the highlight mentions similar words, but that the highlight's content
actually demonstrates or grounds the takeaway's claim.

Return a JSON array where each element is:
{"takeawayIdx": <number>, "grounded": <boolean>, "backingHighlightIdx": <number|null>}

Rules:
- "grounded": true if at least one highlight with that takeawayIdx genuinely
  supports the takeaway's claim.
- "grounded": false if no mapped highlight supports it (the highlight may
  have the wrong takeawayIdx, or the takeaway may be ungrounded in the
  transcript).
- "backingHighlightIdx": the idx of the strongest supporting highlight, or
  null if grounded is false.
- If a takeaway has no mapped highlights at all (all highlights have
  takeawayIdx: null or map to other takeaways), set grounded: false and
  backingHighlightIdx: null.
- Return exactly one entry per takeaway, in takeaway-index order (0-indexed).`;
}

export function buildHighlightsReconciliationUserMessage(
  takeaways: string[],
  highlights: ExtractedHighlight[]
): string {
  const takeawaysBlock = takeaways
    .map((t, i) => `${i + 1}. ${t}`)
    .join('\n');

  const highlightsBlock = highlights
    .map((h, i) => `[idx=${i}, ${h.start}–${h.end}] ${h.label} (takeawayIdx: ${h.takeawayIdx ?? 'null'})`)
    .join('\n');

  return `--- KEY TAKEAWAYS ---\n${takeawaysBlock}\n\n--- HIGHLIGHTS (with takeawayIdx mappings) ---\n${highlightsBlock}\n\nFor each takeaway (1-indexed above, 0-indexed in output), determine if it is grounded by at least one highlight.`;
}

/** 'invalid' (couldn't parse) is distinct from 'ok' — same pattern as
 *  highlights-extraction.ts. The caller must never clobber an existing
 *  reconciliation on 'invalid' (a transient LLM/parse failure), only ever
 *  replace it on 'ok'. */
export type ReconciliationParseResult =
  | { status: 'invalid' }
  | { status: 'ok'; reconciliation: ReconciliationResult };

export function parseHighlightsReconciliation(rawText: string, takeawaysCount: number): ReconciliationParseResult {
  const jsonMatch = rawText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { status: 'invalid' };

  let raw: unknown;
  try {
    raw = JSON.parse(jsonMatch[0]);
  } catch {
    return { status: 'invalid' };
  }
  if (!Array.isArray(raw)) return { status: 'invalid' };

  const out: ReconciledTakeaway[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { takeawayIdx, grounded, backingHighlightIdx } = item as Record<string, unknown>;
    if (typeof takeawayIdx !== 'number' || !Number.isFinite(takeawayIdx)) continue;
    if (typeof grounded !== 'boolean') continue;
    // backingHighlightIdx is number or null
    let parsedBackingIdx: number | null = null;
    if (typeof backingHighlightIdx === 'number' && Number.isFinite(backingHighlightIdx)) {
      parsedBackingIdx = backingHighlightIdx;
    }
    out.push({
      idx: takeawayIdx,
      grounded,
      backingHighlightIdx: parsedBackingIdx,
    });
  }

  // Validate: exactly takeawaysCount entries
  if (out.length !== takeawaysCount) return { status: 'invalid' };

  return { status: 'ok', reconciliation: { takeaways: out } };
}

/** Derive the verbatim transcript excerpt for a highlight by slicing the
 *  transcript segments whose start falls within [start, end). Zero LLM
 *  cost — pure array filter + join. (§2.C.1 of the design doc.) */
export function buildVerbatimExcerpt(
  start: number,
  end: number,
  segments: Array<{ start: number; text: string }>
): string {
  return segments
    .filter((s) => s.start >= start && s.start < end)
    .map((s) => s.text)
    .join(' ')
    .trim();
}
