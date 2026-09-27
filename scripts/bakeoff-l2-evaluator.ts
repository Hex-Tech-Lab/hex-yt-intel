#!/usr/bin/env tsx
/**
 * L2 Bake-off Evaluator v2 — permanent benchmark harness (ADR 2026-09-27,
 * 5-Layer Jev-Gated Architecture, Phase A).
 *
 * Validated protocol (Rounds 1-4, 2026-09-26/27):
 *   - Chunked map-reduce extraction for transcripts > 24k chars (24k windows,
 *     2k overlap, GLM fact-preserving merge). Naive slicing collapses parity
 *     by ~20+ points on 40m+ videos (Round 3 measured).
 *   - FULL-transcript Jev grading (Decisions API, 1M ctx, ~$0.0006/grade).
 *     A 12k grading slice suppressed ~19 points of parity (Round 3 measured).
 *   - Judge = Jev only (~typesafe/jev-latest via /api/alpha/decisions, resolves
 *     typesafe/jev-1.13-20260917). NEVER a chat-completions model, NEVER
 *     typesafe/jev-router (that is a prompt-routing tool, not a judge).
 *   - Transcript-grounded parity (baseline-only parity penalizes faithful
 *     models for Haiku's verified baseline inventions — 401k/529/18%-vs-14%).
 *   - Drafts persisted after extraction so no LLM work is ever wasted.
 *   - Reporting: median + P25/P75 + pass rate + per-dim table (mean also shown;
 *     median is the headline per user directive).
 *
 * SSOT contracts:
 *   - Dim 0 = analyses.executive_digest jsonb column (NOT analysis_payload).
 *   - Dims 1-11 = payload.dimensions[].content keyed by dimensions[].number.
 *   - DB auth: SUPABASE_SERVICE_ROLE_KEY (bypasses RLS); billing_status=eq.completed.
 *   - Transcript: public.transcripts.content (72h TTL) → /tmp/opencode/transcripts
 *     cache → live YouTube → TranscriptAPI (TRANSCRIPTAPI_API_KEY).
 *   - Provider pins (user directives): GPT-OSS-120B → groq; GLM → together (gmicloud
 *     cost fallback); allow_fallbacks false (sticky providers).
 *   - promptVersion pinned per run (R9): UCIS v5.4 as of 2026-09-25 (c4125116).
 *
 * Staged execution: BAKEOFF_VIDEOS="id1,id2" runs a stripe. Incremental HTML.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY ?? '';

if (!SUPABASE_URL || !SUPABASE_KEY || !OPENROUTER_KEY) {
  console.error('[bakeoff] Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY');
  process.exit(1);
}

const DB_HEADERS = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const PROMPT_VERSION = 'UCIS v5.4 (c4125116, 2026-09-25) — unmodified';
const TRANSCRIPT_CACHE_DIR = '/tmp/opencode/transcripts';

// ─── Curated diverse benchmark pool (frozen 14, R7) ──────────────────────────
const CURATED_VIDEO_IDS = [
  'Z6l4HpuyyP0', 'ymgH8jS6Wb8', 'MoBr0nQtOnA', '_LCeJZFIsd4', 'DlNWYzaL_F0',
  'LTNVA2iP9YU', '1U8-4N1HNtU', 'yB92mx97A8s', 'gneNjQuLv88', 'GOLgLU54b5s',
  'EoKdX13w7SI', 'pjGvA-D0Fcs', 'uZ5kJ9CBbv0', '39hqY3nH5ug',
];
const STRIPE_VIDEO_IDS = process.env.BAKEOFF_VIDEOS
  ? process.env.BAKEOFF_VIDEOS.split(',').map((s: string) => s.trim()).filter(Boolean)
  : CURATED_VIDEO_IDS;

// ─── Models (pinned providers, sticky) ───────────────────────────────────────
type Model = { id: string; label: string; provider: { order: string[]; allow_fallbacks: boolean }; reasoning: boolean };
const MODELS: Model[] = [
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS-120B', provider: { order: ['groq', 'together'], allow_fallbacks: false }, reasoning: true },
  { id: 'z-ai/glm-5.3-flash', label: 'GLM-5.3-Flash', provider: { order: ['baseten', 'morph', 'together'], allow_fallbacks: false }, reasoning: true },
  { id: 'openai/gpt-6-luna', label: 'GPT-6-Luna', provider: { order: ['openai'], allow_fallbacks: false }, reasoning: true },
  { id: 'openai/gpt-6-luna-pro', label: 'GPT-6-Luna-Pro', provider: { order: ['openai'], allow_fallbacks: false }, reasoning: true },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama-3.3-70B', provider: { order: ['groq'], allow_fallbacks: false }, reasoning: false },
];
const MERGE_MODEL = MODELS[1]; // GLM for fact-preserving chunk merges

// ─── Types ────────────────────────────────────────────────────────────────────
type StoredExecutiveDigest = { snapshot?: string; takeaways?: string[]; overview?: string; detailedSummary?: string };
type DimEntry = { number: number; name: string; content: string };
interface AnalysisPayload {
  dimensions?: DimEntry[];
  videoMetadata?: { title?: string; duration?: number; channelTitle?: string };
}
interface AnalysisRecord {
  video_id: string;
  analysis_payload: AnalysisPayload;
  executive_digest?: StoredExecutiveDigest | null;
}
interface GradeResult { info: number; style: number; reasoning: string }
type DimResult = { videoId: string; dimName: string; grades: Record<string, GradeResult> };
type DimTrend = {
  dimName: string;
  byModel: Record<string, { medInfo: number; medStyle: number; p25Info: number; p75Info: number; p25Style: number; p75Style: number; meanInfo: number; meanStyle: number; pass: boolean; n: number }>;
  videoCount: number;
};

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
const median = (xs: number[]) => quantile(xs, 0.5);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ─── DB helpers ───────────────────────────────────────────────────────────────
async function fetchAnalysesForVideos(videoIds: string[]): Promise<Map<string, AnalysisRecord>> {
  const inClause = `(${videoIds.map(id => `"${id}"`).join(',')})`;
  const url = `${SUPABASE_URL}/rest/v1/analyses?select=video_id,analysis_payload,executive_digest&billing_status=eq.completed&video_id=in.${inClause}&order=created_at.desc`;
  const res = await fetch(url, { headers: DB_HEADERS });
  const data: AnalysisRecord[] = await res.json();
  const map = new Map<string, AnalysisRecord>();
  if (!Array.isArray(data)) { console.error('[bakeoff] Unexpected analyses response:', data); return map; }
  for (const row of data) if (!map.has(row.video_id)) map.set(row.video_id, row);
  return map;
}

async function fetchTranscriptFromDB(videoId: string): Promise<string> {
  const url = `${SUPABASE_URL}/rest/v1/transcripts?select=content&video_id=eq.${videoId}&limit=1`;
  const res = await fetch(url, { headers: DB_HEADERS });
  const data = await res.json();
  return Array.isArray(data) && data[0]?.content ? data[0].content as string : '';
}

function fetchTranscriptFromCache(videoId: string): string {
  try { return fs.readFileSync(path.join(TRANSCRIPT_CACHE_DIR, `${videoId}.txt`), 'utf8'); } catch (err) { console.error('[bakeoff-cache]', err); return ''; }
}

async function fetchTranscriptFromYouTube(videoId: string): Promise<string> {
  // timedtext → watch-page captionTracks (existing validated path)
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
  try {
    const listRes = await fetch(`https://www.youtube.com/api/timedtext?type=list&v=${videoId}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (listRes.ok) {
      const lang = (await listRes.text()).match(/lang_code="([^"]+)"/)?.[1] ?? 'en';
      const transRes = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
      if (transRes.ok) {
        const json = await transRes.json() as { events?: { segs?: { utf8?: string }[] }[] };
        const text = (json.events ?? []).flatMap(e => e.segs ?? []).map(s => s.utf8 ?? '').join(' ').replace(/\s+/g, ' ').trim();
        if (text.length > 200) return text;
      }
    }
  } catch (err) { console.error('[bakeoff-yt-transcript]', err); }
  const TAPI = process.env.TRANSCRIPTAPI_API_KEY ?? '';
  if (TAPI) {
    try {
      const res = await fetch(`https://transcriptapi.com/api/v2/youtube/transcript?video_url=${encodeURIComponent(videoId)}&format=json`, { headers: { Authorization: `Bearer ${TAPI}` }, signal: AbortSignal.timeout(60000) });
      if (res.ok) {
        const body = await res.json() as { transcript?: { text?: string; start?: number; duration?: number }[] };
        const text = (Array.isArray(body.transcript) ? body.transcript : [])
          .filter(s => typeof s.start === 'number' && typeof s.duration === 'number' && (s.text ?? '').length > 0)
          .map(s => (s.text ?? '').replace(/\s+/g, ' ').trim()).join(' ').replace(/\s+/g, ' ').trim();
        if (text.length > 200) return text;
      }
    } catch (err) { console.error('[bakeoff-tapi]', err); }
  }
  return '';
}

// ─── Dim 0 / dims helpers ────────────────────────────────────────────────────
function getBaselineForDimension(payload: AnalysisPayload, digest: StoredExecutiveDigest | null, dimIndex: number): string {
  if (dimIndex === 0) {
    if (!digest) return '';
    return [digest.snapshot, ...(digest.takeaways ?? []), digest.overview, digest.detailedSummary].filter(Boolean).join('\n\n');
  }
  return (payload.dimensions ?? []).find(d => d.number === dimIndex)?.content ?? '';
}
function getDimensionName(payload: AnalysisPayload, dimIndex: number): string {
  if (dimIndex === 0) return 'Executive Digest';
  return (payload.dimensions ?? []).find(d => d.number === dimIndex)?.name ?? `Dimension ${dimIndex}`;
}

// ─── OpenRouter (challenger models) ──────────────────────────────────────────
async function runOpenRouter(m: Model, system: string, user: string, maxTokens: number): Promise<string> {
  const tokenLimit = Math.max(maxTokens, 6000);
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://getvintel.com', 'X-Title': 'hex-yt-intel/bakeoff-l2' },
    body: JSON.stringify({
      model: m.id,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      temperature: 0.2, seed: 42,
      max_tokens: tokenLimit,
      reasoning: m.reasoning ? { effort: 'minimal' } : undefined,
      include_reasoning: false,
      provider: m.provider,
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

// ─── Jev judge (Decisions API — verified shapes, ~$0.0006/full-ctx grade) ────
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest'; // resolves typesafe/jev-1.13-20260917
const SCORE_LEGEND = Array.from({ length: 10 }, (_, i) => `Grade ${i} out of 9 — 9 means all key facts captured; 0 means nothing captured`);
const FULL_CTX_CHARS = 160000; // verified: full-transcript grading vs 12k slice = +19 parity points

async function jevDecide(state: Record<string, unknown>, questions: Record<string, unknown>): Promise<Record<string, { score?: number }> | null> {
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://getvintel.com', 'X-Title': 'hex-yt-intel/bakeoff-l2' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) { console.error(`[jev] ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`); return null; }
    const data = await res.json() as { answers?: Record<string, { score?: number }> };
    return data.answers ?? null;
  } catch (error) { console.error('[jev] Call failed:', error instanceof Error ? error.message : String(error)); return null; }
}

async function chatJudgeDecide(state: { transcript: string; baseline: string; challenger: string }): Promise<Record<string, { score?: number }> | null> {
  try {
    const prompt = `You are an expert evaluator for video analysis quality.
Compare the challenger's output against the ground truth transcript and baseline.

TRANSCRIPT EXCERPT:
${state.transcript.slice(0, 30000)}

BASELINE:
${state.baseline.slice(0, 10000)}

CHALLENGER:
${state.challenger.slice(0, 10000)}

Grade from 0 to 9 on two metrics:
1. InformationParity (0-9): does the challenger capture the key facts, entities, arguments and data points from the TRANSCRIPT that matter for this dimension? Facts in the baseline that are NOT in the transcript do not count against the challenger.
2. StyleConsistency (0-9): does the challenger match the baseline tone (analytical, dense, objective), formatting (bullets, bolding, tables) and depth?

Output ONLY valid JSON in this exact format:
{"InformationParity": {"score": 8}, "StyleConsistency": {"score": 8}}`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://getvintel.com', 'X-Title': 'hex-yt-intel/bakeoff-l2' },
      body: JSON.stringify({
        model: 'openai/gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content?.trim() ?? '{}';
    const parsed = JSON.parse(content) as Record<string, { score?: number }>;
    return {
      InformationParity: { score: typeof parsed.InformationParity?.score === 'number' ? parsed.InformationParity.score : 0 },
      StyleConsistency: { score: typeof parsed.StyleConsistency?.score === 'number' ? parsed.StyleConsistency.score : 0 },
    };
  } catch (error) {
    console.error('[judge-fallback] Fallback judge call failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

const scoreTo100 = (s?: number) => (s === undefined || !Number.isFinite(s)) ? 0 : Math.round((Math.max(0, Math.min(9, s)) / 9) * 100);

async function judgeChallenger(baseline: string, challenger: string, transcript: string): Promise<GradeResult> {
  if (!baseline.trim()) return { info: 100, style: 100, reasoning: 'Baseline empty — skip' };
  if (!challenger.trim() || challenger.startsWith('Error:')) return { info: 0, style: 0, reasoning: `Challenger failed: ${challenger.slice(0, 100)}` };
  const state = { transcript: transcript.slice(0, FULL_CTX_CHARS), baseline: baseline.slice(0, 20000), challenger: challenger.slice(0, 20000) };
  let answers = await jevDecide(state, {
    InformationParity: {
      type: 'score',
      instructions: 'Grade Information Parity from 0 to 9: does the challenger capture the key facts, entities, arguments and data points from the TRANSCRIPT that matter for this dimension? Facts in the baseline that are NOT in the transcript do not count against the challenger — but facts the transcript supports that the challenger omitted DO.',
      criteria: SCORE_LEGEND,
    },
    StyleConsistency: {
      type: 'score',
      instructions: 'Grade Style Consistency from 0 to 9: does the challenger match the baseline tone (analytical, dense, objective), formatting (bullets, bolding, tables) and depth?',
      criteria: SCORE_LEGEND,
    },
  });
  let judgeSource = 'Jev';
  if (!answers) {
    console.warn('[judge] Jev Decisions API unavailable, attempting GPT-4o fallback judge...');
    answers = await chatJudgeDecide(state);
    judgeSource = 'GPT-4o';
  }
  if (!answers) return { info: 0, style: 0, reasoning: 'Judge unavailable (Jev & fallback failed)' };
  return {
    info: scoreTo100(answers.InformationParity?.score),
    style: scoreTo100(answers.StyleConsistency?.score),
    reasoning: `${judgeSource} parity=${answers.InformationParity?.score ?? 'n/a'} style=${answers.StyleConsistency?.score ?? 'n/a'} (0-9)`,
  };
}

// ─── Chunked map-reduce extraction (validated Round 3) ───────────────────────
const CHUNK_SIZE = 24000, CHUNK_OVERLAP = 2000;
function chunkTranscript(transcript: string): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < transcript.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const c = transcript.slice(i, i + CHUNK_SIZE);
    if (c.trim().length > 200) chunks.push(c);
    if (i + CHUNK_SIZE >= transcript.length) break;
  }
  return chunks.length > 0 ? chunks : [transcript];
}

async function extractDimension(m: Model, dim: number, dimName: string, transcript: string): Promise<string> {
  const chunks = chunkTranscript(transcript);
  const perChunk: string[] = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const sys = `You are Hex-YT-Intel's UCIS analysis engine.\nAnalyze this YouTube transcript SEGMENT (${ci + 1}/${chunks.length}) for Dimension ${dim}: "${dimName}".\nExtract the substance. Analytical, dense, objective. Do not invent facts not in the segment. Output only the dimension content.`;
    try { perChunk.push(await runOpenRouter(m, sys, chunks[ci], 16000)); } catch (error) { console.error(`[${m.label}] dim${dim} chunk${ci}: ${error instanceof Error ? error.message : String(error)}`); perChunk.push(''); }
  }
  const valid = perChunk.filter(t => t);
  if (valid.length === 0) return '';
  if (valid.length === 1) return valid[0];
  const mergeSys = `Merge these partial dimension extracts of the same video segment-by-segment into ONE coherent section. Preserve EVERY fact, number, entity and claim from all parts; remove only true duplication. Do not invent anything. Output only the merged dimension content.`;
  try {
    return await runOpenRouter(MERGE_MODEL, mergeSys, valid.map((t, i) => `--- PART ${i + 1} ---\n${t.slice(0, 12000)}`).join('\n\n'), 16000);
  } catch (error) {
    console.error(`[merge] dim${dim}: ${error instanceof Error ? error.message : String(error)}`);
    return valid.join('\n\n');
  }
}

// ─── Aggregation + incremental report ────────────────────────────────────────
function aggregateAndWrite(allResults: DimResult[], ts: number, outDir: string): { jsonPath: string; htmlPath: string; trendsByDim: Record<number, DimTrend> } {
  const trendsByDim: Record<number, DimTrend> = {};
  for (let dim = 0; dim <= 11; dim++) {
    const dimResults = allResults.filter(r => r.dimName.startsWith(`Dim ${dim}:`));
    if (dimResults.length === 0) continue;
    const byModel: DimTrend['byModel'] = {};
    for (const m of MODELS) {
      const gs = dimResults.map(r => r.grades[m.label]).filter(Boolean);
      const infos = gs.map(g => g.info).filter(v => v > 0 || gs.some(x => x.info === 0));
      const styles = gs.map(g => g.style);
      const par = gs.filter(g => g.info > 0);
      byModel[m.label] = {
        medInfo: median(par.map(g => g.info)), medStyle: median(par.map(g => g.style)),
        p25Info: quantile(par.map(g => g.info), 0.25), p75Info: quantile(par.map(g => g.info), 0.75),
        p25Style: quantile(par.map(g => g.style), 0.25), p75Style: quantile(par.map(g => g.style), 0.75),
        meanInfo: mean(par.map(g => g.info)), meanStyle: mean(par.map(g => g.style)),
        pass: par.length > 0 && par.every(g => g.info >= 90 && g.style >= 85),
        n: par.length,
      };
    }
    trendsByDim[dim] = { dimName: dimResults[0]?.dimName ?? `Dim ${dim}`, byModel, videoCount: dimResults.length };
  }
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `BAKEOFF_L2_TRENDS_${ts}.json`);
  const payload = JSON.stringify({ promptVersion: PROMPT_VERSION, trendsByDim, allResults }, null, 2);
  fs.writeFileSync(jsonPath, payload);
  fs.writeFileSync(path.join(outDir, 'BAKEOFF_L2_TRENDS_LATEST.json'), payload);

  const modelCols = MODELS.map(m => `<th colspan="4">${m.label}</th>`).join('');
  const subHead = MODELS.map(() => '<th>medP</th><th>medS</th><th>P25–P75</th><th>Pass</th>').join('');
  const rows = Object.entries(trendsByDim).map(([, v]) => {
    const cells = MODELS.map(m => {
      const t = v.byModel[m.label];
      if (!t || t.n === 0) return '<td>—</td><td>—</td><td>—</td><td>—</td>';
      return `<td>${t.medInfo.toFixed(0)}</td><td>${t.medStyle.toFixed(0)}</td><td>${t.p25Info.toFixed(0)}–${t.p75Info.toFixed(0)} / ${t.p25Style.toFixed(0)}–${t.p75Style.toFixed(0)}</td><td style="font-size:1.1em">${t.pass ? '✅' : '❌'}</td>`;
    }).join('');
    return `<tr><td>${v.dimName}</td><td>${v.videoCount}</td>${cells}</tr>`;
  }).join('\n');
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>L2 Bake-off v2</title>
<style>body{font-family:-apple-system,sans-serif;padding:2rem;color:#1a1a1a}h1{border-bottom:2px solid #2563eb;padding-bottom:.5rem}.meta{color:#6b7280;font-size:.9rem;margin-bottom:1.5rem}table{border-collapse:collapse;width:100%;font-size:.85rem}th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}td{padding:6px 10px;border-bottom:1px solid #e5e7eb}</style></head>
<body>
<h1>L2 Bake-off v2 (chunked extraction · full-context Jev · median reporting)</h1>
<div class="meta">Generated: ${new Date().toISOString()} · promptVersion: ${PROMPT_VERSION} · Judge: ${JEV_MODEL} (Decisions API) · Threshold: medParity ≥ 90 AND medStyle ≥ 85 · Haiku 4.5 baselines from existing completed analyses — no re-runs charged</div>
<table><thead><tr><th rowspan="2">Dimension</th><th rowspan="2">N</th>${modelCols}</tr><tr>${subHead}</tr></thead>
<tbody>
${rows}
</tbody></table>
<p style="color:#6b7280;font-size:.8rem">medP/medS = median parity/style · P25–P75 = interquartile ranges (parity / style) · Pass requires EVERY graded video ≥90 parity AND ≥85 style</p>
</body></html>`;
  const htmlPath = path.join(outDir, `BAKEOFF_L2_TRENDS_${ts}.html`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(outDir, 'BAKEOFF_L2_TRENDS_LATEST.html'), html);
  return { jsonPath, htmlPath, trendsByDim };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[bakeoff-v2] Chunked extraction · full-context Jev · median reporting');
  console.log(`[bakeoff-v2] promptVersion: ${PROMPT_VERSION}`);
  console.log(`[bakeoff-v2] Stripe: ${STRIPE_VIDEO_IDS.length} video(s)`);

  const analysisMap = await fetchAnalysesForVideos(STRIPE_VIDEO_IDS);
  const allResults: DimResult[] = [];
  const outDir = path.join(__dirname, '..', 'docs', 'history');
  const tsRun = Date.now();

  for (const videoId of STRIPE_VIDEO_IDS) {
    const record = analysisMap.get(videoId);
    if (!record) { console.warn(`[bakeoff] No completed analysis for ${videoId}, skipping`); continue; }
    let transcript = await fetchTranscriptFromDB(videoId);
    if (!transcript) transcript = fetchTranscriptFromCache(videoId);
    if (!transcript) transcript = await fetchTranscriptFromYouTube(videoId);
    if (!transcript) { console.warn(`[bakeoff] No transcript for ${videoId}, skipping`); continue; }

    const payload = record.analysis_payload;
    const title = payload.videoMetadata?.title ?? videoId;
    console.log(`\n[bakeoff] ▶ ${title} (${videoId}) — transcript ${transcript.length} chars`);

    const entries: { num: number; name: string; baseline: string }[] = [
      { num: 0, name: 'Executive Digest', baseline: getBaselineForDimension(payload, record.executive_digest ?? null, 0) },
      ...(payload.dimensions ?? []).map(d => ({ num: d.number, name: d.name, baseline: d.content })),
    ].filter(e => e.baseline.trim());

    const drafts = new Map<string, { num: number; text: string }[]>();
    await Promise.all(MODELS.map(async m => {
      const ds: { num: number; text: string }[] = [];
      for (const e of entries) ds.push({ num: e.num, text: await extractDimension(m, e.num, e.name, transcript) });
      drafts.set(m.label, ds);
      console.log(`[extract] ${m.label}: ${ds.filter(d => d.text).length}/${entries.length} ok`);
    }));
    fs.writeFileSync(`/tmp/opencode/bakeoff_${videoId}_drafts.json`, JSON.stringify(Object.fromEntries([...drafts]), null, 2));

    for (const e of entries) {
      const grades: Record<string, GradeResult> = {};
      for (const m of MODELS) {
        const text = (drafts.get(m.label) ?? []).find(d => d.num === e.num)?.text ?? '';
        grades[m.label] = await judgeChallenger(e.baseline, text, transcript);
      }
      const line = MODELS.map(m => `${m.label}: ${grades[m.label].info}/${grades[m.label].style}`).join(' | ');
      console.log(`  [dim ${e.num}] ${e.name} — ${line}`);
      allResults.push({ videoId, dimName: `Dim ${e.num}: ${e.name}`, grades });
    }
    aggregateAndWrite(allResults, tsRun, outDir);
  }

  const final = aggregateAndWrite(allResults, tsRun, outDir);
  console.log(`\n[bakeoff] ✅ Complete\n  JSON: ${final.jsonPath}\n  HTML: ${final.htmlPath}`);
}

main().catch(err => { console.error('[bakeoff] Fatal:', err); process.exit(1); });
