import { parseJsonArray } from '@/lib/utils/json-parser';
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
import type { ReconciledTakeaway, ReconciliationResult } from '@/lib/ports/ExecutiveDigestPorts';

export type { ReconciledTakeaway, ReconciliationResult };

export function buildHighlightsReconciliationSystemPrompt(): string {
  return `You are a fact-checking assistant for video analysis. You are given:
1. A list of key takeaways from an executive summary of a video.
2. A list of timestamped highlights extracted from that video's transcript.

For each takeaway, find the highlight that best semantically supports its claim — not just
that the highlight mentions similar words, but that the highlight's content
actually demonstrates or grounds the takeaway's claim.

Return a JSON array where each element is:
{"takeawayIdx": <number>, "grounded": <boolean>, "backingHighlightIdx": <number|null>}

Rules:
- "grounded": true if you found a highlight that genuinely supports the takeaway's claim.
- "grounded": false if no highlight supports it (the takeaway may be ungrounded in the transcript).
- "backingHighlightIdx": the idx of the strongest supporting highlight, or null if grounded is false.
- Return exactly one entry per takeaway, in takeaway-index order (0-indexed).`;
}

export function buildHighlightsReconciliationUserMessage(
  takeaways: string[],
  highlights: ExtractedHighlight[]
): string {
  const takeawaysBlock = takeaways
    .map((takeaway, index) => `${index + 1}. ${takeaway}`)
    .join('\n');

  const highlightsBlock = highlights
    .map((highlight, index) => `[idx=${index}, ${highlight.start}–${highlight.end}] ${highlight.label}`)
    .join('\n');

  return `--- KEY TAKEAWAYS ---\n${takeawaysBlock}\n\n--- HIGHLIGHTS ---\n${highlightsBlock}\n\nFor each takeaway (1-indexed above, 0-indexed in output), determine if it is grounded by at least one highlight.`;
}

/** 'invalid' (couldn't parse) is distinct from 'ok' — same pattern as
 *  highlights-extraction.ts. The caller must never clobber an existing
 *  reconciliation on 'invalid' (a transient LLM/parse failure), only ever
 *  replace it on 'ok'. */
export type ReconciliationParseResult =
  | { status: 'invalid' }
  | { status: 'ok'; reconciliation: ReconciliationResult };

export function parseHighlightsReconciliation(
  rawText: string,
  takeawaysCount: number,
  highlightsCount?: number
): ReconciliationParseResult {
  const parseResult = parseJsonArray(rawText, 'highlights-reconciliation');
  if (parseResult.status === 'invalid') return { status: 'invalid' };
  const raw = parseResult.data;
  if (!Array.isArray(raw)) return { status: 'invalid' };

  const out: ReconciledTakeaway[] = [];
  const seenIdx = new Set<number>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { takeawayIdx, grounded, backingHighlightIdx } = item as Record<string, unknown>;
    if (typeof takeawayIdx !== 'number' || !Number.isInteger(takeawayIdx)) continue;
    if (takeawayIdx < 0 || takeawayIdx >= takeawaysCount) continue;
    // Duplicate takeawayIdx is ambiguous (the LLM gave conflicting verdicts for
    // the same takeaway) — reject the entire result as invalid rather than
    // silently keeping the first entry, which would persist a non-deterministic
    // grounding status.
    if (seenIdx.has(takeawayIdx)) return { status: 'invalid' };
    if (typeof grounded !== 'boolean') return { status: 'invalid' };
    if (grounded && (typeof backingHighlightIdx !== 'number' || !Number.isInteger(backingHighlightIdx) || backingHighlightIdx < 0)) return { status: 'invalid' };
    if (grounded && highlightsCount !== undefined && backingHighlightIdx >= highlightsCount) return { status: 'invalid' };
    if (!grounded && backingHighlightIdx != null) return { status: 'invalid' };
    
    seenIdx.add(takeawayIdx);
    out.push({ idx: takeawayIdx, grounded, backingHighlightIdx: grounded ? (backingHighlightIdx as number) : null });
  }

  if (out.length !== takeawaysCount) return { status: 'invalid' };
  out.sort((left, right) => left.idx - right.idx);
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
    .filter((segment) => segment.start >= start && segment.start < end)
    .map((segment) => segment.text)
    .join(' ')
    .trim();
}
