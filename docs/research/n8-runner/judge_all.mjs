import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { groundTruthFor, VIDEOS, BUNDLES } from './run.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const resultsDir = path.join(ROOT, 'docs/research/n8-runner/results');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');
const JUDGE_MODEL = 'anthropic/claude-haiku-4.5';
const JUDGE_PROMPT_VERSION = '1.0.0';

// Verbatim copy of docs/research/parity-test-harness/judge-prompt.ts's
// JUDGE_SYSTEM_PROMPT (unmodified, same string) -- inlined here only because
// judge.ts's own module runs its CLI main() unconditionally on import, which
// exits the process; the committed judge-prompt.ts content is reused as-is.
const JUDGE_SYSTEM_PROMPT = `You are a strict, deterministic grading judge for a YouTube-content-intelligence pipeline's UCIS v5.3 output format. You compare a CANDIDATE model's bundle output against a GROUND-TRUTH model's bundle output for the SAME video and SAME dimensions, and against an explicit REQUIRED SUBSECTIONS checklist for those dimensions.

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

const REQUIRED_SUBSECTIONS = {
  1: ['[EXECUTIVE_SUMMARY]', '[SHORT_SUMMARY]', '[LONG_SUMMARY]'],
  2: ['2.1 Header Intelligence', '2.2 Engagement & Virality Metrics', '2.3 Channel Authority Assessment', '2.4 Audience Sentiment Prediction'],
  3: ['3.1 Executive Overview', '3.2 First Principles Deconstruction', '3.3 Temporal Content Map & Arc Analysis'],
  4: ['4.1 Sentiment & Tonal Profile', '4.2 Persuasion Strategy', '4.3 Bias Detection & Critical Assessment'],
  5: ['5.1 Priority Insights Matrix', '5.2 Power Quotes Library', '5.3 Referenced Entities'],
  6: ['6.1 Comparison Tables', '6.2 Scenario Analysis'],
  7: ['7.1 Implementation Systems', '7.2 Execution Sequencing & Dependencies'],
  8: ['8.1 Primary Knowledge Graph Nodes', '8.2 Semantic Relations', '8.3 Cross-Domain Bridges', '8.4 Discovery Pathways'],
  9: ['9.1 Trend Projections', '9.2 Identified Gaps', '9.3 Unconventional Tangents & Cross-Domain Applications', '9.4 Unfair Advantages (persona-keyed)', '9.5 Contrarian Perspectives'],
  10: ['10.1 Recommendation Credibility Score', '10.2 Domain-Specific Risk Disclosures', '10.3 Final Classification'],
  11: ['11.1 AdSense RPM & Display Revenue Potential', '11.2 Sponsorship & Brand Partnership CPM', '11.3 Lead Generation & Service Monetization Value', '11.4 Affiliate & E-Commerce Monetization', '11.5 Persona-Weighted Monetization Strategy', '11.6 Monetization Risk & Sustainability Assessment', '11.7 Monetization Verdict (Persona-Weighted Summary)'],
};

function requiredSubsectionsForBundle(dims) {
  return dims.flatMap((d) => (REQUIRED_SUBSECTIONS[d] || []).map((s) => `D${d}: ${s}`));
}

function buildJudgeUserMessage({ dims, requiredSubsections, candidateOutput, groundTruthOutput }) {
  return `DIMENSIONS IN THIS BUNDLE: [${dims.join(', ')}]

REQUIRED SUBSECTIONS CHECKLIST (${requiredSubsections.length} items):
${requiredSubsections.map((s) => `- ${s}`).join('\n')}

=== GROUND TRUTH OUTPUT (reference model) ===
${groundTruthOutput}

=== CANDIDATE OUTPUT (model under test) ===
${candidateOutput}

Score the CANDIDATE per the system instructions. Respond with ONLY the JSON object.`;
}

async function judgeBundlePair({ dims, candidateOutput, groundTruthOutput }) {
  const requiredSubsections = requiredSubsectionsForBundle(dims);
  const userMessage = buildJudgeUserMessage({ dims, requiredSubsections, candidateOutput, groundTruthOutput });
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: JUDGE_MODEL,
      temperature: 0,
      max_tokens: 1600,
      messages: [
        { role: 'system', content: JUDGE_SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenRouter judge call failed: ${res.status} ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Judge response had no parseable JSON: ${raw.slice(0, 500)}`);
  const parsed = JSON.parse(match[0]);
  return {
    structural_completeness: Number(parsed.structural_completeness) || 0,
    factual_coverage: Number(parsed.factual_coverage) || 0,
    missing_subsections: Array.isArray(parsed.missing_subsections) ? parsed.missing_subsections : [],
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    judge_model: JUDGE_MODEL,
  };
}

async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let idx = 0;
  async function next() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, next));
  return results;
}

async function main() {
  const final = {};
  for (const dims of BUNDLES) {
    const key = dims.join('_');
    const genFile = path.join(resultsDir, `gen_${key}.json`);
    const genData = JSON.parse(fs.readFileSync(genFile, 'utf-8'));
    const judged = await pool(genData.results, 4, async (r) => {
      const gt = groundTruthFor(r.video_id, dims);
      try {
        const result = await judgeBundlePair({ dims, candidateOutput: r.gen_text, groundTruthOutput: gt });
        console.error(`[judge] bundle=[${key}] video=${r.video_id} structural=${result.structural_completeness} factual=${result.factual_coverage}`);
        return { ...r, judge: result };
      } catch (e) {
        console.error(`[judge] FAILED bundle=[${key}] video=${r.video_id}: ${e.message}`);
        return { ...r, judge: null, judge_error: String(e.message) };
      }
    });
    final[key] = judged;
    fs.writeFileSync(path.join(resultsDir, `judged_${key}.json`), JSON.stringify(judged, null, 2));
  }
  fs.writeFileSync(path.join(resultsDir, `judged_all.json`), JSON.stringify(final, null, 2));
  console.error('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });
