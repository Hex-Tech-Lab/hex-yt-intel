/**
 * THE fixed, written-down judge prompt for the UCIS parity-test harness.
 *
 * WHY THIS FILE EXISTS: on 2026-08-18 (see §10 of
 * docs/research/2026-08-18-full-dimension-parity-batch-test.md), the judge
 * prompt was reconstructed from a prose description each new test round
 * because the actual wording used in the prior round's scratch harness was
 * never committed. Re-running the SAME already-proven checklist-fix
 * technique on bundle [1,10] (previously 100.0/100, zero known defect)
 * scored only 47.5 under the from-scratch-rebuilt judge — pure judge-
 * calibration drift, not a real prompt regression, but it silently
 * invalidated every cross-round comparison in that cohort (~$3.14 spent on
 * numbers that turned out not to be comparable to each other).
 *
 * RULE GOING FORWARD: this exact string is the judge. Never regenerate it
 * from memory or a prose summary in a new session. If it must change,
 * change it here, bump JUDGE_PROMPT_VERSION, and treat any comparison across
 * versions the same way §10 treats its own drift — flagged, not hidden.
 */

export const JUDGE_PROMPT_VERSION = '1.0.0';

export const JUDGE_SYSTEM_PROMPT = `You are a strict, deterministic grading judge for a YouTube-content-intelligence pipeline's UCIS v5.3 output format. You compare a CANDIDATE model's bundle output against a GROUND-TRUTH model's bundle output for the SAME video and SAME dimensions, and against an explicit REQUIRED SUBSECTIONS checklist for those dimensions.

Score two things, both 0-100 integers:

1. "structural_completeness": what fraction of the REQUIRED SUBSECTIONS checklist items are present in the CANDIDATE's output as clearly labeled, substantively filled entries (not just a bare header with no content, and not a bare "[Insufficient Data]" placeholder where the ground truth demonstrates real content was extractable). Compute this as (subsections satisfied / total required subsections) * 100, rounded to the nearest integer. List every subsection you counted as missing or placeholder-only in "missing_subsections", using the exact "D<n>: <subsection name>" labels given to you in the checklist.

2. "factual_coverage": of the concrete facts, entities, figures, quotes, and claims that appear in the GROUND-TRUTH output, what fraction also appear (accurately, not contradicted) in the CANDIDATE's output. This is about substance overlap, not format. Score 0-100.

Rules:
- Judge only what is written. Do not reward a subsection for existing if its content is a placeholder, a restated header with no information, or a generic template with brackets left unfilled.
- A dimension's content that correctly and explicitly invokes the source prompt's own "Insufficient Data Protocol" (i.e., the transcript genuinely lacks the needed information) still counts as satisfying that subsection structurally — flag it in missing_subsections only if the GROUND-TRUTH output shows the information was actually available and the CANDIDATE skipped it anyway.
- Never let the ground-truth's own limitations depress the candidate's score — grade the candidate against the required-subsections checklist and against what the ground truth actually demonstrates was extractable, not against an idealized transcript.
- Temperature-0 determinism is expected of you: given the same three inputs (candidate, ground truth, checklist) you must return the same scores every time. Do not vary your scoring standard between calls.

Respond with ONLY a single JSON object, no prose, no markdown fences:
{
  "structural_completeness": <integer 0-100>,
  "factual_coverage": <integer 0-100>,
  "missing_subsections": ["D<n>: <subsection name>", ...]
}`;

export function buildJudgeUserMessage(params: {
  dims: number[];
  requiredSubsections: string[];
  candidateOutput: string;
  groundTruthOutput: string;
}): string {
  const { dims, requiredSubsections, candidateOutput, groundTruthOutput } = params;
  return `DIMENSIONS IN THIS BUNDLE: [${dims.join(', ')}]

REQUIRED SUBSECTIONS CHECKLIST (${requiredSubsections.length} items):
${requiredSubsections.map((s) => `- ${s}`).join('\n')}

=== GROUND TRUTH OUTPUT (reference model) ===
${groundTruthOutput}

=== CANDIDATE OUTPUT (model under test) ===
${candidateOutput}

Score the CANDIDATE per the system instructions. Respond with ONLY the JSON object.`;
}
