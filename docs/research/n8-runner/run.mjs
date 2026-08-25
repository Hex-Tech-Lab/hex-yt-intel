// Real n=8 x 5-bundle combined-fix validation runner. Not a production file.
// Reads real transcripts, builds combined prompt (base UCIS v5.3 + checklist +
// guardrail + estimate fix + exhaustive-extraction mandate), generates with
// GPT-OSS-120B via OpenRouter, judges against real Haiku 4.5 ground truth
// using the committed judge harness.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY not set');

// ---- UCIS_V5_3_SYSTEM (extract via regex from the .ts source, no TS import needed) ----
const ucisSrc = fs.readFileSync(path.join(ROOT, 'web/lib/prompts/ucis-v5.3.ts'), 'utf-8');
const m = ucisSrc.match(/export const UCIS_V5_3_SYSTEM = `([\s\S]*)`;\s*$/);
if (!m) throw new Error('Could not extract UCIS_V5_3_SYSTEM');
const UCIS_V5_3_SYSTEM = m[1];

const DIMENSION_NAMES = {
  1: 'APEX INTELLIGENCE', 2: 'PROVENANCE, METADATA & VIRALITY PROFILE',
  3: 'CONTENT ARCHITECTURE & FIRST PRINCIPLES', 4: 'PSYCHOLOGICAL & RHETORICAL LAYER',
  5: 'CORE INTELLIGENCE EXTRACTION', 6: 'COMPARATIVE & QUANTITATIVE ANALYSIS',
  7: 'IMPLEMENTATION SYSTEMS & WORKFLOWS', 8: 'SEMANTIC & KNOWLEDGE GRAPH FOUNDATION',
  9: 'FORWARD INTELLIGENCE & STRATEGIC FORESIGHT', 10: 'CREDIBILITY, RISK & META-ASSESSMENT',
  11: 'COMMERCIAL YIELD & MONETIZATION PROFILING',
};
const EXTRA_FIELDS = { 1: ['persona'], 8: ['knowledgeGraph'], 11: ['classification', 'monetizationVerdict'] };

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

const BUNDLES = [[1, 10], [8], [2, 4, 6], [5, 7], [3, 9, 11]];

const GUARDRAIL = `HALLUCINATION GUARDRAIL: Do not fabricate ungrounded numbers, statistics, or facts not supported by the transcript or reasonable inference from it. Reasoned estimates derived from real signals in the transcript (audience size/niche, content category, engagement patterns, production quality) are acceptable and expected wherever a dimension calls for estimation. For content that is genuinely non-monetizable or non-forecastable, use N/A or invoke the Insufficient Data Protocol rather than inventing a figure.`;

const ESTIMATE_FIX = `ESTIMATION MANDATE FOR FORECASTING/MONETIZATION DIMENSIONS (applies wherever Dimensions 3, 9, or 11 are present in this segment): these dimensions require real analytical ESTIMATES and INFERENCES, not just verbatim extraction. The transcript not literally stating a number (an exact RPM, CPM, growth rate, etc.) is NOT sufficient grounds by itself to invoke the Insufficient Data Protocol -- reason from the video's real observable signals (niche, audience signals, content type, production quality, calls-to-action) to produce a genuine estimate or range, the way a human analyst would. Only invoke the Insufficient Data Protocol when the content is genuinely and categorically non-monetizable/non-forecastable (e.g. pure public-interest broadcast news with no commercial angle whatsoever), never merely because a specific number isn't explicitly stated.`;

const EXHAUSTIVE_MANDATE = `EXHAUSTIVE EXTRACTION MANDATE: Do NOT summarize, paraphrase, or compress this segment's content into terse one-line bullets. Where the framework above shows a numbered example item (e.g. a "1." entry), that is a FORMAT EXAMPLE ONLY, not an instruction to stop after one item -- continue filling every real, distinct item the transcript actually supports, up to its true content ceiling, not a fixed count. For every named sub-field a dimension requires per item (for example, Tier-1 Insights: verbatim quote, timestamp, "Why this matters", Evidence quality, Lens applied; Implementation Systems: Prerequisite, Steps, Success metrics, Common pitfalls, Troubleshooting guide, Risk factors & mitigation), you MUST fill every one of those named sub-fields for every item you output -- never drop a sub-field to save space. Prioritize completeness and fidelity to the source transcript over brevity.`;

function checklistFor(dims) {
  const list = dims.flatMap((d) => (REQUIRED_SUBSECTIONS[d] || []).map((s) => `D${d}: ${s}`)).join('; ');
  return `SELF-VERIFICATION CHECKLIST (perform this silently against your own draft before emitting final output; do not mention having done it): For each dimension listed above, confirm your draft contains a clearly labeled entry for every one of these required subsections: ${list}. If any required subsection is missing from your draft, add it now (using the Insufficient Data Protocol from section 0.6 if the transcript genuinely lacks the content) before finalizing your response.`;
}

function buildPrompt(dims, transcript, title) {
  const metadataJson = JSON.stringify({ title, channelTitle: '', viewCount: '', likeCount: '', commentCount: '', publishedAt: '', duration: 'Unknown' }, null, 2);
  const dimLabels = dims.map((d) => `- ### DIMENSION ${d} - ${DIMENSION_NAMES[d]}`).join('\n');
  const label = dims.length === 1 ? `DIMENSION ${dims[0]}` : `DIMENSIONS ${dims.join(', ')}`;
  const extraParts = [];
  const seen = new Set();
  for (const d of dims) {
    for (const f of EXTRA_FIELDS[d] || []) {
      if (seen.has(f)) continue;
      seen.add(f);
      if (f === 'persona') extraParts.push('include the "persona" configuration block in the JSON root');
      if (f === 'knowledgeGraph') extraParts.push('generate and include the full "knowledgeGraph" object in the JSON root (max 15 nodes, 20 edges)');
      if (f === 'classification') extraParts.push('generate and include the full "classification" object in the JSON root');
      if (f === 'monetizationVerdict') extraParts.push('generate and include the full "monetizationVerdict" object in the JSON root');
    }
  }
  const extraInstr = extraParts.length > 0 ? extraParts.join(', and ') : 'do NOT include persona, knowledgeGraph, classification, or monetizationVerdict fields';
  const extraFieldsInstruction = extraParts.length > 0 ? `You must also ${extraInstr}.` : `Additionally, ${extraInstr}.`;
  const fallbackInstructions = `If insufficient data exists for any dimension, invoke the Insufficient Data Protocol (section 0.6) and provide a brief explanation in the content field rather than leaving it empty. Never output empty dimensions arrays; always include dimension objects with at least a summary note.`;

  const base = `${UCIS_V5_3_SYSTEM}

---

## ACTIVE ANALYSIS SESSION

**Metadata JSON Blob**:
\`\`\`json
${metadataJson}
\`\`\`

**Persona Configuration**:
- CREATOR: Creator (Weight: 100%)

**Timezone**: UTC

**Transcript**:
${transcript.slice(0, 48000)}${transcript.length > 48000 ? '\n\n[...transcript truncated to 48K characters...]' : ''}`;

  const segment = `

---
CRITICAL INSTRUCTION FOR THIS SEGMENT ANALYSIS (${label}):
You are performing a segmented analysis of the content. For this request, you must ONLY generate the following dimension(s):
${dimLabels}

Your output JSON object must ONLY include these dimension(s) inside the "dimensions" array. Start the JSON envelope structure with "schemaVersion": "2.0". ${extraFieldsInstruction}
Your response must enforce a strict maximum output restriction of 400 analytical words per dimension.
${fallbackInstructions}
Do NOT output any other dimensions. Do NOT include any other JSON root fields. Your response must be strict, raw JSON without markdown formatting. Ensure that your output strictly matches this layout.`;

  const fixes = `

---
${GUARDRAIL}

${checklistFor(dims)}

${dims.some((d) => [3, 9, 11].includes(d)) ? ESTIMATE_FIX + '\n\n' : ''}${EXHAUSTIVE_MANDATE}`;

  return base + segment + fixes;
}

async function generate(prompt) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      temperature: 0.3,
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`gen failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return {
    text: data?.choices?.[0]?.message?.content ?? '',
    finish: data?.choices?.[0]?.finish_reason,
    cost: data?.usage?.total_tokens ? undefined : undefined,
    usage: data?.usage,
  };
}

// ---- videos + ground truth ----
const VIDEOS = [
  { id: 'FfdOoDB_fbE', lang: 'en', title: 'How To Spy on Shopify Competitors & Steal Their Winning Products' },
  { id: 'vEC6e5dBi4Y', lang: 'ar', title: 'فيلم ثمن الحرية - Thmn El Horeya' },
  { id: 'wcgvQs_9Yx8', lang: 'be', title: 'Пільна! Хапун пад Расонамі' },
  { id: 'sw22FMB_SWI', lang: 'he', title: 'האלוף עוזי דיין' },
  { id: '9T8L73AidFY', lang: 'ja', title: '保守×革新から新旧へ' },
  { id: 'LTNVA2iP9YU', lang: 'de', title: 'Unions-Fraktionschef Frei' },
  { id: 'gCU0n6H_MXo', lang: 'fr', title: "L'histoire du mur de Berlin" },
  { id: 'ctR1jrI42uc', lang: 'zh', title: '中文教学播客' },
];

const oldBatch = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/research/2026-08-18-parity-batch-results.json'), 'utf-8'));
const newGT = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/research/2026-08-18-round10-results/haiku_new_videos.json'), 'utf-8'));

function findOldVideo(id) {
  return Object.values(oldBatch.videos).find((v) => v.video_id === id);
}

function groundTruthFor(videoId, dims) {
  if (videoId === 'gCU0n6H_MXo' || videoId === 'ctR1jrI42uc') {
    const key = `${videoId}_${dims.join('_')}`;
    const entry = newGT[key];
    if (!entry) throw new Error(`missing new GT for ${key}`);
    return entry.text;
  }
  const v = findOldVideo(videoId);
  if (!v) throw new Error(`no old-batch video for ${videoId}`);
  return dims.map((d) => v.dimensions[`dimension_${d}`]?.haiku_output || '').join('\n\n');
}

function transcriptFor(videoId) {
  return fs.readFileSync(path.join(ROOT, `docs/research/2026-08-18-parity-test-transcripts/${videoId}.txt`), 'utf-8');
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
  const mode = process.argv[2]; // 'gen' or 'judge'
  const outDir = path.join(ROOT, 'docs/research/n8-runner/results');
  fs.mkdirSync(outDir, { recursive: true });

  if (mode === 'gen') {
    const bundleArg = process.argv[3]; // e.g. "1,10"
    const dims = bundleArg.split(',').map(Number);
    const tasks = VIDEOS.map((v) => ({ v, dims }));
    let totalCost = 0;
    const results = await pool(tasks, 4, async ({ v, dims }) => {
      const transcript = transcriptFor(v.id);
      const prompt = buildPrompt(dims, transcript, v.title);
      const t0 = Date.now();
      const gen = await generate(prompt);
      const ms = Date.now() - t0;
      console.error(`[gen] bundle=[${dims}] video=${v.id} (${v.lang}) finish=${gen.finish} len=${gen.text.length} ${ms}ms`);
      return { video_id: v.id, lang: v.lang, dims, gen_text: gen.text, finish: gen.finish, usage: gen.usage };
    });
    const outFile = path.join(outDir, `gen_${dims.join('_')}.json`);
    fs.writeFileSync(outFile, JSON.stringify({ dims, results }, null, 2));
    console.error(`Wrote ${outFile}`);
  } else {
    throw new Error('unknown mode');
  }
}

if (process.argv[1] && process.argv[1].endsWith('run.mjs')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { groundTruthFor, transcriptFor, VIDEOS, BUNDLES };
