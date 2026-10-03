#!/usr/bin/env tsx
/**
 * L2 Bake-off Evaluator v3 — ADR 038 §4b gate harness (R6).
 *
 * v2 → v3 changes (dispatch 2026-10-03):
 *   - Arms: `haiku` (DB baseline, or generated legacy v5.4 baseline for the
 *     5 uncovered ids), `glm-only` (single-pass GLM-5.3-flash, v2 recipe),
 *     `glm-oss` (two-step from articulation-exercise.mts: GLM per-dim
 *     extraction → single openai/gpt-oss-120b articulation pass over GLM's
 *     output — the transcript NEVER reaches OSS, only the assembled GLM
 *     drafts; R2 evidence-provenance boundary preserved).
 *   - Judge split: FactualParity (transcript truth; unsupported claims
 *     LOWER the score regardless of baseline) vs StyleParity (composition
 *     vs the Haiku baseline prose). Unsupported-claims listed per grade.
 *     EVERY arm — including haiku — is graded by the same judge against the
 *     full transcript. Haiku StyleParity-vs-itself is the reference = 100
 *     by definition (not judged).
 *   - Per-video JSON records (written incrementally): factual/style medians,
 *     unsupported-claim rate, paired diffs vs haiku, strata metadata.
 *   - ADR 038 §4b gate: pure evaluator in scripts/bakeoff-gate.ts +
 *     unit tests in scripts/quality-engine/bakeoff-gate.test.ts.
 *   - `--generate-baselines` (OFF by default): rebuilds the 5 missing Haiku
 *     baselines with the EXACT legacy UCIS v5.4 prompt as of c4125116
 *     (historical monolith; ~$1.2/video; writes local JSON, NOT prod DB).
 *
 * Carried from v2 (validated protocol, ADR 038 §2):
 *   - Chunked map-reduce extraction for transcripts > 24k chars.
 *   - FULL-transcript Jev grading (Decisions API, ~$0.0006/grade).
 *   - Judge = Jev only (~typesafe/jev-latest). NEVER a chat model, NEVER
 *     jev-router. GPT-4o chat fallback retained for Jev outages only.
 *   - promptVersion pinned per run (R9): UCIS v5.4 as of 2026-09-25 (c4125116).
 *   - DB auth: SUPABASE_SERVICE_ROLE_KEY (read-only queries only).
 *
 * Usage:
 *   BAKEOFF_VIDEOS="Z6l4HpuyyP0" pnpm exec tsx scripts/bakeoff-l2-evaluator.ts
 *   pnpm exec tsx scripts/bakeoff-l2-evaluator.ts --generate-baselines
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { evaluateGate, type GateInput, type VideoArmScores } from './bakeoff-gate';

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
const BASELINE_CACHE_DIR = '/tmp/opencode/bakeoff-baselines';

// ─── Curated diverse benchmark pool (frozen 14, R7) ──────────────────────────
const CURATED_VIDEO_IDS = [
  'Z6l4HpuyyP0', 'ymgH8jS6Wb8', 'MoBr0nQtOnA', '_LCeJZFIsd4', 'DlNWYzaL_F0',
  'LTNVA2iP9YU', '1U8-4N1HNtU', 'yB92mx97A8s', 'gneNjQuLv88', 'GOLgLU54b5s',
  'EoKdX13w7SI', 'pjGvA-D0Fcs', 'uZ5kJ9CBbv0', '39hqY3nH5ug',
];
// The 5 pool ids without an existing Haiku baseline (CC-verified 2026-10-03).
const MISSING_BASELINE_IDS = ['yB92mx97A8s', '_LCeJZFIsd4', 'DlNWYzaL_F0', 'uZ5kJ9CBbv0', '39hqY3nH5ug'];
const STRIPE_VIDEO_IDS = process.env.BAKEOFF_VIDEOS
  ? process.env.BAKEOFF_VIDEOS.split(',').map((s: string) => s.trim()).filter(Boolean)
  : CURATED_VIDEO_IDS;

const GENERATE_BASELINES = process.argv.includes('--generate-baselines');

// ─── Arms ────────────────────────────────────────────────────────────────────
type ProviderPin = { order: string[]; allow_fallbacks: boolean };
type ArmId = 'haiku' | 'glm-only' | 'glm-oss';
interface ArmDef {
  id: ArmId;
  label: string;
  models: string[];
  providers: ProviderPin[];
  reasoning: boolean;
  /** Where the arm's per-dimension text comes from. */
  kind: 'baseline' | 'single-extract' | 'two-step';
}
const ARMS: ArmDef[] = [
  { id: 'haiku', label: 'Haiku 4.5', models: ['anthropic/claude-haiku-4.5'], providers: [], reasoning: false, kind: 'baseline' },
  {
    id: 'glm-only', label: 'GLM-5.3-Flash', models: ['z-ai/glm-5.3-flash'],
    providers: [{ order: ['baseten', 'morph', 'together'], allow_fallbacks: false }],
    reasoning: true, kind: 'single-extract',
  },
  {
    id: 'glm-oss', label: 'GLM→OSS', models: ['z-ai/glm-5.3-flash', 'openai/gpt-oss-120b'],
    providers: [
      { order: ['together'], allow_fallbacks: false },               // GLM extraction leg
      { order: ['groq', 'together'], allow_fallbacks: false },      // OSS articulation leg
    ],
    reasoning: true, kind: 'two-step',
  },
];
const MERGE_MODEL = ARMS.find(a => a.id === 'glm-only')!; // GLM fact-preserving chunk merges

// ─── Types ────────────────────────────────────────────────────────────────────
type StoredExecutiveDigest = { snapshot?: string; takeaways?: string[]; overview?: string; detailedSummary?: string };
type DimEntry = { number: number; name: string; content: string };
interface AnalysisPayload {
  dimensions?: DimEntry[];
  videoMetadata?: { title?: string; duration?: number; channelTitle?: string };
  classification?: Record<string, unknown>;
}
interface AnalysisRecord {
  video_id: string;
  analysis_payload: AnalysisPayload;
  executive_digest?: StoredExecutiveDigest | null;
}
interface GradeResult { factual: number; style: number; unsupported: string[]; reasoning: string }
type DimResult = { videoId: string; dimName: string; grades: Record<ArmId, GradeResult> };

interface PerVideoRecord {
  videoId: string;
  promptVersion: string;
  transcriptChars: number;
  strata: { class?: string; language: string; durationBucket: string; classSource: string };
  arms: Record<ArmId, {
    model: string[];
    reasoningEffort: string;
    factualMedian: number; factualP25: number; factualP75: number;
    styleMedian: number; styleP25: number; styleP75: number;
    unsupportedCount: number; unsupportedRate: number; dimsGraded: number;
    costUsd: number;
  }>;
  pairedDiffsVsHaiku: Record<Exclude<ArmId, 'haiku'>, { factual: number; style: number }>;
  costNote: string;
}

interface CostLedger { [call: string]: { prompt_tokens: number; completion_tokens: number; total_cost: number | null } }

// ─── Math helpers ────────────────────────────────────────────────────────────
function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? loVal;
  return loVal + (hiVal - loVal) * (idx - lo);
}
const median = (xs: number[]) => quantile(xs, 0.5);

// ─── DB helpers (read-only) ──────────────────────────────────────────────────
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
  try { return fs.readFileSync(path.join(TRANSCRIPT_CACHE_DIR, `${videoId}.txt`), 'utf8'); } catch (error) { console.warn(`[cache] ${videoId}: ${error instanceof Error ? error.message : String(error)}`); return ''; }
}

async function fetchTranscriptFromYouTube(videoId: string): Promise<string> {
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

// ─── OpenRouter ──────────────────────────────────────────────────────────────
interface ORResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}
async function runOpenRouter(modelId: string, provider: ProviderPin, system: string, user: string, maxTokens: number, reasoning: boolean, ledger: CostLedger, ledgerKey: string): Promise<string> {
  const tokenLimit = Math.max(maxTokens, 6000);
  // 3-attempt retry on transient provider errors (429/5xx/timeouts). Providers
  // are pinned with allow_fallbacks=false, so a single transient blip (e.g.
  // BaseTen 429→504 seen in smoke 1) otherwise zeroes a whole dimension.
  const MAX_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://getvintel.com', 'X-Title': 'hex-yt-intel/bakeoff-l2' },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          temperature: 0.2, seed: 42,
          max_tokens: tokenLimit,
          reasoning: reasoning ? { effort: 'minimal' } : undefined,
          include_reasoning: false,
          provider,
        }),
        signal: AbortSignal.timeout(300000),
      });
      if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text().catch(() => '')).slice(0, 200)}`);
      const data = await response.json() as ORResponse;
      if (data.usage) {
        ledger[ledgerKey] = {
          prompt_tokens: data.usage.prompt_tokens ?? 0,
          completion_tokens: data.usage.completion_tokens ?? 0,
          total_cost: data.usage.cost ?? null,
        };
      }
      return data.choices?.[0]?.message?.content?.trim() ?? '';
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        const backoffMs = attempt * 5000;
        console.warn(`[openrouter] ${ledgerKey} attempt ${attempt} failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)}), retrying in ${backoffMs / 1000}s`);
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ─── Jev judge (Decisions API) ───────────────────────────────────────────────
const JEV_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest'; // resolves typesafe/jev-1.13-20260917
const SCORE_LEGEND = Array.from({ length: 10 }, (_, i) => `Grade ${i} out of 9 — 9 means perfect adherence to the criteria; 0 means complete failure`);
const FULL_CTX_CHARS = 160000; // full-transcript grading (validated Round 3)

const FACTUAL_INSTRUCTIONS = `Grade Factual Parity from 0 to 9, measuring STRICT adherence to the TRANSCRIPT's truth:
- Coverage: does the challenger capture the key facts, entities, arguments and data points the TRANSCRIPT supports for this dimension?
- Unsupported-claim penalty: any claim, number, entity, tool or system the challenger asserts that the TRANSCRIPT does NOT support LOWERS the score — regardless of whether the reference baseline contains the same claim. A baseline claim that the transcript does not support is NOT truth.
- Omission of transcript-supported facts also lowers the score.
9 = all transcript-supported facts captured, zero unsupported claims. 0 = nothing captured or mostly invented.`;

const STYLE_INSTRUCTIONS = `Grade Style Parity from 0 to 9, measuring editorial composition against the reference baseline's prose:
- Tone (analytical, dense, objective), formatting (headers, bullets, bolding, tables), density and analytical depth relative to the baseline.
- FACTUAL CORRECTNESS IS NOT SCORED HERE — a factually wrong but stylistically perfect answer can score high on this metric alone.`;

interface JudgeOutput { factual: number; style: number; unsupported: string[]; source: string }

async function jevDecide(state: Record<string, unknown>, questions: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENROUTER_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://getvintel.com', 'X-Title': 'hex-yt-intel/bakeoff-l2' },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) { console.error(`[jev] ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`); return null; }
    const data = await res.json() as { answers?: Record<string, unknown> };
    return data.answers ?? null;
  } catch (error) { console.error('[jev] Call failed:', error instanceof Error ? error.message : String(error)); return null; }
}

async function chatJudgeDecide(state: { transcript: string; baseline: string; challenger: string }): Promise<JudgeOutput | null> {
  try {
    const prompt = `You are an expert evaluator for video analysis quality.
Compare the challenger's output against the ground truth transcript and baseline.

TRANSCRIPT EXCERPT:
${state.transcript.slice(0, 30000)}

REFERENCE BASELINE (Haiku output — NOT ground truth):
${state.baseline.slice(0, 10000)}

CHALLENGER:
${state.challenger.slice(0, 10000)}

Grade from 0 to 9 on two metrics:
1. FactualParity (0-9): strict adherence to the TRANSCRIPT's truth. Claims NOT supported by the transcript lower the score regardless of the baseline. Omissions of transcript-supported facts lower the score.
2. StyleParity (0-9): tone, formatting, density and depth vs the baseline. Do NOT score factual correctness here.
Also list every challenger claim (verbatim snippets) that the transcript does not support.

Output ONLY valid JSON:
{"FactualParity": {"score": 8}, "StyleParity": {"score": 8}, "UnsupportedClaims": ["claim 1", "claim 2"]}`;
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
    const parsed = JSON.parse(data.choices?.[0]?.message?.content?.trim() ?? '{}') as {
      FactualParity?: { score?: number }; StyleParity?: { score?: number }; UnsupportedClaims?: unknown;
    };
    return {
      factual: scoreTo100(parsed.FactualParity?.score),
      style: scoreTo100(parsed.StyleParity?.score),
      unsupported: Array.isArray(parsed.UnsupportedClaims) ? (parsed.UnsupportedClaims as unknown[]).map(String) : [],
      source: 'GPT-4o-fallback',
    };
  } catch (error) {
    console.error('[judge-fallback] Fallback judge call failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

const scoreTo100 = (s?: number) => (s === undefined || !Number.isFinite(s)) ? 0 : Math.round((Math.max(0, Math.min(9, s)) / 9) * 100);

/** Grade ONE dimension output against the FULL transcript + the haiku baseline. */
async function judgeDimension(baseline: string, challenger: string, transcript: string): Promise<GradeResult> {
  if (!challenger.trim() || challenger.startsWith('Error:')) {
    return { factual: 0, style: 0, unsupported: [], reasoning: `Arm output failed: ${challenger.slice(0, 100)}` };
  }
  const state = {
    transcript: transcript.slice(0, FULL_CTX_CHARS),
    baseline: baseline.slice(0, 20000),
    challenger: challenger.slice(0, 20000),
  };
  let answers = await jevDecide(state, {
    FactualParity: { type: 'score', instructions: FACTUAL_INSTRUCTIONS, criteria: SCORE_LEGEND },
    StyleParity: { type: 'score', instructions: STYLE_INSTRUCTIONS, criteria: SCORE_LEGEND },
    UnsupportedClaims: {
      // Decisions API question types are 'noul' | 'choice' | 'score' only —
      // 'list' is invalid (verified 2026-10-03: 400 invalid_union). Use a
      // binary 'choice' with legible criteria; exact verbatim snippets come
      // from the fallback judge path, this counts presence of unsupported
      // claims for the per-arm unsupported-claim rate.
      type: 'choice',
      instructions: 'Does the CHALLENGER assert any claim, number, entity, tool or system that the TRANSCRIPT does not support? Choose the best label.',
      criteria: { none: 'no unsupported claims', 'one-or-more': 'at least one unsupported claim' },
    },
  });
  let source = 'Jev';
  if (answers && typeof answers === 'object') {
    const fp = answers.FactualParity as { score?: number } | undefined;
    const sp = answers.StyleParity as { score?: number } | undefined;
    const uc = answers.UnsupportedClaims as { choice?: string } | undefined;
    if (typeof fp?.score !== 'number' || typeof sp?.score !== 'number') answers = null;
    else {
      return {
        factual: scoreTo100(fp.score),
        style: scoreTo100(sp.score),
        unsupported: uc?.choice === 'one-or-more' ? ['[jev] unsupported claims present (binary choice)'] : [],
        reasoning: `${source} factual=${fp.score} style=${sp.score} unsupported=${uc?.choice === 'one-or-more' ? 1 : 0} (0-9)`,
      };
    }
  }
  const fallback = await chatJudgeDecide(state);
  if (!fallback) return { factual: 0, style: 0, unsupported: [], reasoning: 'Judge unavailable (Jev & fallback failed)' };
  // Fallback is for Jev OUTAGES only (user directive). Any appearance here in
  // an ordinary run is a contract failure — keep the marker loud in results.
  console.warn(`[judge] WARNING: GPT-4o fallback used — Jev did not answer. Reasoning: ${fallback.source}`);
  return { factual: fallback.factual, style: fallback.style, unsupported: fallback.unsupported, reasoning: fallback.source };
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

async function extractDimension(arm: ArmDef, dim: number, dimName: string, transcript: string, ledger: CostLedger, videoId: string): Promise<string> {
  const chunks = chunkTranscript(transcript);
  const perChunk: string[] = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const sys = `You are Hex-YT-Intel's UCIS analysis engine.\nAnalyze this YouTube transcript SEGMENT (${ci + 1}/${chunks.length}) for Dimension ${dim}: "${dimName}".\nExtract the substance. Analytical, dense, objective. Do not invent facts not in the segment. Output only the dimension content.`;
    try {
      perChunk.push(await runOpenRouter(arm.models[0]!, arm.providers[0]!, sys, chunks[ci]!, 16000, arm.reasoning, ledger, `${videoId}/arm-${arm.id}/dim${dim}/chunk${ci}`));
    } catch (error) {
      console.error(`[${arm.id}] dim${dim} chunk${ci}: ${error instanceof Error ? error.message : String(error)}`);
      perChunk.push('');
    }
  }
  const valid = perChunk.filter(t => t);
  if (valid.length === 0) return '';
  if (valid.length === 1) return valid[0] ?? '';
  const mergeSys = `Merge these partial dimension extracts of the same video segment-by-segment into ONE coherent section. Preserve EVERY fact, number, entity and claim from all parts; remove only true duplication. Do not invent anything. Output only the merged dimension content.`;
  try {
    return await runOpenRouter(MERGE_MODEL.models[0]!, MERGE_MODEL.providers[0]!, mergeSys, valid.map((t, i) => `--- PART ${i + 1} ---\n${t.slice(0, 12000)}`).join('\n\n'), 16000, true, ledger, `${videoId}/arm-${arm.id}/dim${dim}/merge`);
  } catch (error) {
    console.error(`[merge] dim${dim}: ${error instanceof Error ? error.message : String(error)}`);
    return valid.join('\n\n');
  }
}

// ─── GLM→OSS two-step (ported from /tmp/opencode/articulation-exercise.mts) ──
async function articulateWithOSS(dimDrafts: { num: number; name: string; text: string }[], ledger: CostLedger, videoId: string): Promise<Map<number, string>> {
  const ossArm = ARMS.find(a => a.id === 'glm-oss')!;
  const assembled = dimDrafts.map(d => `### DIM ${d.num} ${d.name}\n${d.text}`).join('\n\n');
  const artSys = `You are the articulation editor for Hex-YT-Intel's UCIS analysis output.
Below are dimension drafts extracted from a YouTube transcript. Rewrite them for superior articulation: precise, dense, objective, analytically sharp, consistent formatting (markdown headers, bullets, bold), matching the established Hex-YT-Intel house style.
STRICT RULE: do not add, invent, or extrapolate any fact not present in the drafts. Preserve every number, entity, and claim. Preserve the section structure.
Output ONLY the rewritten content, keeping each section header exactly as "### DIM <number> <name>".`;
  const articulated = await runOpenRouter(ossArm.models[1]!, ossArm.providers[1]!, artSys, assembled, 20000, true, ledger, `${videoId}/arm-glm-oss/articulation`);
  const parts = new Map<number, string>();
  const re = /### DIM (\d+) ?[^\n]*/g;
  const marks = [...articulated.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const num = Number(marks[i]![1]);
    const body = articulated.slice((marks[i]!.index ?? 0) + marks[i]![0].length, i + 1 < marks.length ? marks[i + 1]!.index : undefined).trim();
    if (body) parts.set(num, body);
  }
  return parts;
}

// ─── Strata helpers ──────────────────────────────────────────────────────────
// Class source: /tmp/opencode/pool_classification.json — precomputed Jev
// classification over the full 14-video pool (ledger 2026-09-27T00:20 entry;
// ADR 038 §1 Layer 0 classification, class + multi-speaker + inventRisk).
// The analysis_payload.classification field was checked (Step 0a) and holds
// only boolean quality flags — it does NOT carry S1–S6.
function loadPoolClassification(): Map<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync('/tmp/opencode/pool_classification.json', 'utf8')) as Record<string, { class?: string }>;
    return new Map(Object.entries(raw).map(([id, v]) => [id, v.class ?? '']));
  } catch (error) { console.warn(`[strata] pool_classification.json unreadable: ${error instanceof Error ? error.message : String(error)}`); return new Map(); }
}
function durationBucket(seconds?: number): string {
  if (!seconds || !Number.isFinite(seconds)) return 'unknown';
  if (seconds < 300) return '<5m';
  if (seconds < 1200) return '5-20m';
  if (seconds < 2700) return '20-45m';
  return '>45m';
}
function detectLanguage(transcript: string, title: string): string {
  // Coarse heuristic consistent with rounds 1-4 bookkeeping (round 4 = Arabic).
  const arabic = /[\u0600-\u06FF]/;
  if (arabic.test(transcript.slice(0, 2000)) || arabic.test(title)) return 'ar';
  return 'en';
}

// ─── Legacy v5.4 baseline generation (c4125116 monolith) ─────────────────────
// Step 0b findings: at c4125116 the UCIS prompt lives in
// web/lib/prompts/ucis-v5.3.ts (constant UCIS_V5_3_SYSTEM — header says v5.4,
// Persona-Indicator Edition, released 2026-09-25) and assembly happens in
// web/lib/prompts/factory.ts getUCISPrompt(): system prompt + ACTIVE ANALYSIS
// SESSION block (metadata JSON, persona config, timezone, duration notice,
// transcript sliced to 48000 chars, dimensions instruction, closing-tag ban)
// + UCIS_PERSON_CREDIBILITY_GROUNDING appended LAST. The two legacy constants
// were git-extracted into scripts/bakeoff-v54-prompt-legacy.ts (NOT imported
// by any web/ code) so this generator is byte-faithful without checking out
// old code into the worktree.
async function generateLegacyBaselines(): Promise<void> {
  const { UCIS_V5_4_SYSTEM_LEGACY, UCIS_PERSON_CREDIBILITY_GROUNDING_LEGACY, buildLegacyV54Prompt } = await import('./bakeoff-v54-prompt-legacy');
  fs.mkdirSync(BASELINE_CACHE_DIR, { recursive: true });
  const analysisMap = await fetchAnalysesForVideos(MISSING_BASELINE_IDS);
  for (const videoId of MISSING_BASELINE_IDS) {
    const cachedPath = path.join(BASELINE_CACHE_DIR, `${videoId}.v54-baseline.json`);
    if (fs.existsSync(cachedPath)) { console.log(`[baselines] ${videoId} already generated, skipping`); continue; }
    const record = analysisMap.get(videoId);
    const meta = record?.analysis_payload.videoMetadata;
    let transcript = await fetchTranscriptFromDB(videoId);
    if (!transcript) transcript = fetchTranscriptFromCache(videoId);
    if (!transcript) transcript = await fetchTranscriptFromYouTube(videoId);
    if (!transcript) { console.warn(`[baselines] No transcript for ${videoId}, skipping`); continue; }

    // Production shape at c4125116: single monolith call, full analysis in one
    // response (no chunking — chunked multi-chunk PromptBuilder arrived later).
    const metadata = {
      title: meta?.title ?? videoId,
      channelTitle: meta?.channelTitle ?? '',
      viewCount: '', likeCount: '', commentCount: '', publishedAt: '',
    };
    const prompt = buildLegacyV54Prompt(
      UCIS_V5_4_SYSTEM_LEGACY,
      UCIS_PERSON_CREDIBILITY_GROUNDING_LEGACY,
      metadata, transcript, 'creator', 'UTC', meta?.duration,
    );
    console.log(`[baselines] ${videoId}: prompt ${prompt.length} chars, transcript ${transcript.length} chars — calling anthropic/claude-haiku-4.5...`);
    const ledger: CostLedger = {};
    const output = await runOpenRouter(
      'anthropic/claude-haiku-4.5',
      { order: ['anthropic'], allow_fallbacks: false },
      prompt, 'Generate the complete analysis now.', 32000, false, ledger, `${videoId}/v54-baseline`,
    );
    const cost = ledger[`${videoId}/v54-baseline`];
    console.log(`[baselines] ${videoId}: ${output.length} chars, cost=${cost ? JSON.stringify(cost) : 'n/a'}`);
    fs.writeFileSync(cachedPath, JSON.stringify({
      videoId, promptVersion: 'UCIS v5.4 legacy monolith (c4125116) — generated for bakeoff, NOT production', generatedAt: new Date().toISOString(), output, cost: cost ?? null,
    }, null, 2));
  }
  console.log(`[baselines] Done. Outputs in ${BASELINE_CACHE_DIR} (local JSON only — production DB untouched).`);
}

/** Load haiku baseline per video: DB row if present, else generated v5.4 JSON. */
function loadHaikuBaselineTexts(record: AnalysisRecord | undefined, videoId: string): { dim0: string; dims: DimEntry[]; source: string } | null {
  if (record && (record.analysis_payload.dimensions ?? []).length > 0) {
    const p = record.analysis_payload;
    return {
      dim0: getBaselineForDimension(p, record.executive_digest ?? null, 0),
      dims: (p.dimensions ?? []).map(d => ({ number: d.number, name: d.name, content: d.content })),
      source: 'db-baseline',
    };
  }
  const cachedPath = path.join(BASELINE_CACHE_DIR, `${videoId}.v54-baseline.json`);
  if (!fs.existsSync(cachedPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(cachedPath, 'utf8')) as { output: string };
    return { dim0: '', dims: parseLegacyOutput(parsed.output), source: 'generated-v54' };
  } catch (err) {
    console.error(`[baselines] Failed to load generated baseline for ${videoId}:`, err);
    return null;
  }
}

/** Parse a legacy v5.4 monolith output into per-dimension sections. */
function parseLegacyOutput(output: string): DimEntry[] {
  const dims: DimEntry[] = [];
  // UCIS v5.4 outputs dimensions as markdown headers; match "## 1." / "# 1." / "## Dimension 1" styles.
  const re = /^#{1,3}\s*(?:Dimension\s*)?(\d{1,2})[\.\):]?\s*([^\n]*)$/gm;
  const marks = [...output.matchAll(re)];
  for (let i = 0; i < marks.length; i++) {
    const num = Number(marks[i]![1]);
    if (!Number.isFinite(num) || num < 1 || num > 12) continue;
    const body = output.slice((marks[i]!.index ?? 0) + marks[i]![0].length, i + 1 < marks.length ? marks[i + 1]!.index : undefined).trim();
    if (body) dims.push({ number: num, name: marks[i]![2].trim() || `Dimension ${num}`, content: body });
  }
  if (dims.length === 0) {
    // Fallback: one blob mapped to dimension 1 so grading still proceeds.
    dims.push({ number: 1, name: 'Full output (parse fallback)', content: output.slice(0, 20000) });
  }
  return dims;
}

// ─── Aggregation + reports ───────────────────────────────────────────────────
function summarizeArm(grades: GradeResult[]) {
  const f = grades.map(g => g.factual);
  const s = grades.map(g => g.style);
  const unsupportedCount = grades.reduce((a, g) => a + g.unsupported.length, 0);
  return {
    factualMedian: median(f), factualP25: quantile(f, 0.25), factualP75: quantile(f, 0.75),
    styleMedian: median(s), styleP25: quantile(s, 0.25), styleP75: quantile(s, 0.75),
    unsupportedCount, unsupportedRate: grades.length ? unsupportedCount / grades.length : 0,
    dimsGraded: grades.length,
  };
}

function buildPerVideoRecord(
  videoId: string, transcript: string, dimGrades: Map<ArmId, GradeResult[]>,
  ledger: CostLedger, classification: Map<string, string>,
): PerVideoRecord {
  const payloadMeta: Partial<Record<ArmId, string[]>> = {
    haiku: ['anthropic/claude-haiku-4.5'],
    'glm-only': ['z-ai/glm-5.3-flash'],
    'glm-oss': ['z-ai/glm-5.3-flash', 'openai/gpt-oss-120b'],
  };
  const haiku = summarizeArm(dimGrades.get('haiku') ?? []);
  const glmOnly = summarizeArm(dimGrades.get('glm-only') ?? []);
  const glmOss = summarizeArm(dimGrades.get('glm-oss') ?? []);
  const costs: Partial<Record<ArmId, number>> = {};
  for (const arm of ARMS) {
    if (arm.id === 'haiku') continue; // DB baselines: no incremental cost
    costs[arm.id] = Object.entries(ledger)
      .filter(([k]) => k.startsWith(`${videoId}/arm-${arm.id}/`))
      .reduce((a, [, v]) => a + (v.total_cost ?? 0), 0);
  }
  return {
    videoId,
    promptVersion: PROMPT_VERSION,
    transcriptChars: transcript.length,
    strata: {
      class: classification.get(videoId) ?? undefined,
      language: detectLanguage(transcript, videoId),
      durationBucket: 'set-below',
      classSource: '/tmp/opencode/pool_classification.json (Jev Layer 0, precomputed 2026-09-27; payload.classification holds only boolean flags — Step 0a)',
    },
    arms: {
      haiku: { model: payloadMeta.haiku!, reasoningEffort: 'n/a (baseline)', ...haiku, costUsd: 0 },
      'glm-only': { model: payloadMeta['glm-only']!, reasoningEffort: 'minimal', ...glmOnly, costUsd: costs['glm-only'] ?? 0 },
      'glm-oss': { model: payloadMeta['glm-oss']!, reasoningEffort: 'minimal', ...glmOss, costUsd: costs['glm-oss'] ?? 0 },
    },
    pairedDiffsVsHaiku: {
      // haiku − arm, per metric (positive = arm trails haiku)
      'glm-only': { factual: haiku.factualMedian - glmOnly.factualMedian, style: haiku.styleMedian - glmOnly.styleMedian },
      'glm-oss': { factual: haiku.factualMedian - glmOss.factualMedian, style: haiku.styleMedian - glmOss.styleMedian },
    },
    costNote: 'haiku arm = existing DB baseline (no incremental cost); glm costs from OpenRouter usage.cost when reported; judge (Jev) costs not attributed per arm',
  };
}

function writeReport(
  tsRun: number, outDir: string, records: PerVideoRecord[], allResults: DimResult[],
  classification: Map<string, string>, totalSpendUsd: number,
): { jsonPath: string; htmlPath: string; perVideoPath: string } {
  fs.mkdirSync(outDir, { recursive: true });

  // Per-video records (R6 requirement): incremental-friendly standalone JSON.
  const perVideoPath = path.join(outDir, `BAKEOFF_L2_PERVIDEO_${tsRun}.json`);
  const perVideoLatest = path.join(outDir, 'BAKEOFF_L2_PERVIDEO_LATEST.json');
  const perVideoPayload = JSON.stringify({ promptVersion: PROMPT_VERSION, records }, null, 2);
  fs.writeFileSync(perVideoPath, perVideoPayload);
  fs.writeFileSync(perVideoLatest, perVideoPayload);

  // Gate inputs per arm (factual = per-video factual median; style = per-video style median).
  const gateInputs: Record<Exclude<ArmId, 'haiku'>, GateInput> = {
    'glm-only': {
      arm: records.map(r => ({ videoId: r.videoId, factual: r.arms['glm-only'].factualMedian, style: r.arms['glm-only'].styleMedian })),
      haiku: records.map(r => ({ videoId: r.videoId, factual: r.arms.haiku.factualMedian, style: r.arms.haiku.styleMedian })),
    },
    'glm-oss': {
      arm: records.map(r => ({ videoId: r.videoId, factual: r.arms['glm-oss'].factualMedian, style: r.arms['glm-oss'].styleMedian })),
      haiku: records.map(r => ({ videoId: r.videoId, factual: r.arms.haiku.factualMedian, style: r.arms.haiku.styleMedian })),
    },
  };
  const gates = Object.fromEntries(
    (Object.keys(gateInputs) as Exclude<ArmId, 'haiku'>[]).map(id => [id, evaluateGate(gateInputs[id]!)]),
  );

  // Strata tables: overall + by class (S1–S6) + duration bucket + language.
  function strataKey(r: PerVideoRecord): string {
    return `class=${r.strata.class ?? 'n/a'} · dur=${r.strata.durationBucket} · lang=${r.strata.language}`;
  }
  function strataTable(): string {
    const groups = new Map<string, PerVideoRecord[]>();
    for (const r of records) {
      const k = strataKey(r);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(r);
    }
    let html = '';
    for (const [k, rows] of groups) {
      const cells = ARMS.map(a => {
        if (a.id === 'haiku') return '<td>ref</td><td>ref</td>'; // haiku style-vs-itself = 100 by definition
        const meds = rows.map(r => a.id === 'glm-only' ? r.arms['glm-only'] : r.arms['glm-oss']);
        const f = median(meds.map(m => m!.factualMedian));
        const s = median(meds.map(m => m!.styleMedian));
        return `<td>${f.toFixed(0)}</td><td>${s.toFixed(0)}</td>`;
      }).join('');
      html += `<tr><td>${k}</td><td>${rows.length}</td>${cells}</tr>`;
    }
    return html;
  }

  const jsonPath = path.join(outDir, `BAKEOFF_L2_GATE_${tsRun}.json`);
  const payload = JSON.stringify({ promptVersion: PROMPT_VERSION, tsRun, records, allResults, gates, totalSpendUsd }, null, 2);
  fs.writeFileSync(jsonPath, payload);
  fs.writeFileSync(path.join(outDir, 'BAKEOFF_L2_GATE_LATEST.json'), payload);

  const armCols = ARMS.map(a => `<th colspan="3">${a.label}</th>`).join('');
  const armSub = ARMS.map(() => '<th>medF</th><th>medS</th><th>unsup</th>').join('');
  const rows = records.map(r => {
    const cells = ARMS.map(a => {
      if (a.id === 'haiku') return `<td>${r.arms.haiku.factualMedian.toFixed(0)}</td><td>100*</td><td>${r.arms.haiku.unsupportedCount}</td>`;
      const x = a.id === 'glm-only' ? r.arms['glm-only'] : r.arms['glm-oss'];
      return `<td>${x!.factualMedian.toFixed(0)}</td><td>${x!.styleMedian.toFixed(0)}</td><td>${x!.unsupportedCount}</td>`;
    }).join('');
    return `<tr><td>${r.videoId}</td><td>${r.strata.class ?? 'n/a'}</td>${cells}</tr>`;
  }).join('\n');
  const gateRows = (Object.keys(gates) as Exclude<ArmId, 'haiku'>[]).map(id => {
    const g = gates[id]!;
    return `<tr><td>${id}</td><td>${g.pass ? '✅ PASS' : '❌ FAIL'}</td><td>${g.jointPassCount}/${g.totalVideos}</td><td>${g.medianFactual.toFixed(0)}</td><td>${g.medianStyle.toFixed(0)}</td><td>${g.worstFactual.toFixed(0)}</td><td>${g.worstStyle.toFixed(0)}</td><td>${g.worstFactualRegression.toFixed(0)} / ${g.worstStyleRegression.toFixed(0)}</td><td>${g.failures.join('; ') || '—'}</td></tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Bake-off v3 — ADR 038 §4b gate</title>
<style>body{font-family:-apple-system,sans-serif;padding:2rem;color:#1a1a1a}h1,h2{border-bottom:2px solid #2563eb;padding-bottom:.5rem}table{border-collapse:collapse;width:100%;font-size:.85rem;margin-bottom:2rem}th{background:#1e3a5f;color:#fff;padding:8px 10px;text-align:left}td{padding:6px 10px;border-bottom:1px solid #e5e7eb}</style></head>
<body>
<h1>Bake-off v3 — ADR 038 §4b frozen-pool gate</h1>
<p>promptVersion: ${PROMPT_VERSION} · Judge: ${JEV_MODEL} · Haiku style-vs-itself = 100 by definition (*).
FactualParity = transcript-truth adherence + unsupported-claim penalty (baseline inventions penalized); StyleParity = composition vs Haiku prose.</p>
<h2>Gate verdicts (per arm, independent)</h2>
<table><tr><th>Arm</th><th>Verdict</th><th>Joint pass</th><th>medF</th><th>medS</th><th>worstF</th><th>worstS</th><th>Worst regression F/S</th><th>Failures</th></tr>
${gateRows}</table>
<h2>Per-video scores</h2>
<table><tr><th>Video</th><th>Class</th>${armCols}</tr><tr>${armSub}</tr>
${rows}</table>
<h2>Strata (median across videos in stratum)</h2>
<table><tr><th>Stratum</th><th>N</th>${armCols}</tr><tr>${armSub}</tr>
${strataTable()}</table>
<p>Total arm spend (this run): $${totalSpendUsd.toFixed(4)}</p>
</body></html>`;
  const htmlPath = path.join(outDir, `BAKEOFF_L2_GATE_${tsRun}.html`);
  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(path.join(outDir, 'BAKEOFF_L2_GATE_LATEST.html'), html);
  return { jsonPath, htmlPath, perVideoPath };
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (GENERATE_BASELINES) {
    console.log('[bakeoff-v3] --generate-baselines: legacy UCIS v5.4 (c4125116) monolith baselines for the 5 uncovered ids');
    await generateLegacyBaselines();
    return;
  }

  console.log('[bakeoff-v3] ADR 038 §4b gate harness — arms: haiku (baseline) / glm-only / glm-oss (two-step)');
  console.log(`[bakeoff-v3] promptVersion: ${PROMPT_VERSION}`);
  console.log(`[bakeoff-v3] Stripe: ${STRIPE_VIDEO_IDS.length} video(s)`);

  const analysisMap = await fetchAnalysesForVideos(STRIPE_VIDEO_IDS);
  const classification = loadPoolClassification();
  const records: PerVideoRecord[] = [];
  const allResults: DimResult[] = [];
  const ledger: CostLedger = {};
  const outDir = path.join(__dirname, '..', 'docs', 'history');
  const tsRun = Date.now();

  for (const videoId of STRIPE_VIDEO_IDS) {
    const record = analysisMap.get(videoId);
    const baselineInfo = loadHaikuBaselineTexts(record, videoId);
    if (!baselineInfo) { console.warn(`[bakeoff] No DB baseline AND no generated v5.4 baseline for ${videoId} — run --generate-baselines first, skipping`); continue; }
    let transcript = await fetchTranscriptFromDB(videoId);
    if (!transcript) transcript = fetchTranscriptFromCache(videoId);
    if (!transcript) transcript = await fetchTranscriptFromYouTube(videoId);
    if (!transcript) { console.warn(`[bakeoff] No transcript for ${videoId}, skipping`); continue; }

    const payload = record?.analysis_payload ?? { dimensions: [], videoMetadata: {} };
    const title = payload.videoMetadata?.title ?? videoId;
    console.log(`\n[bakeoff] ▶ ${title} (${videoId}) — transcript ${transcript.length} chars, haiku baseline: ${baselineInfo.source}`);

    const entries: { num: number; name: string; baseline: string }[] = [
      { num: 0, name: 'Executive Digest', baseline: baselineInfo.dim0 },
      ...baselineInfo.dims.map(d => ({ num: d.number, name: d.name, baseline: d.content })),
    ].filter(e => e.baseline.trim());
    if (entries.length === 0) { console.warn(`[bakeoff] No non-empty baseline dims for ${videoId}, skipping`); continue; }

    // Arm outputs per dimension.
    const armOutputs = new Map<ArmId, Map<number, string>>();
    armOutputs.set('haiku', new Map(entries.map(e => [e.num, e.baseline])));

    // glm-only: per-dim single-pass (chunked map-reduce) extraction.
    const glmOnly = new Map<number, string>();
    for (const e of entries) glmOnly.set(e.num, await extractDimension(ARMS[1]!, e.num, e.name, transcript, ledger, videoId));
    armOutputs.set('glm-only', glmOnly);

    // glm-oss: reuse glm-only's extraction drafts (identical GLM leg — the
    // two-step recipe re-runs articulation, not extraction), then one OSS pass.
    const glmOss = await articulateWithOSS(entries.map(e => ({ num: e.num, name: e.name, text: glmOnly.get(e.num) ?? '' })), ledger, videoId);
    const glmOssOutputs = new Map<number, string>();
    for (const e of entries) {
      const art = glmOss.get(e.num);
      // Recipe fallback: if the OSS pass dropped a section, keep GLM's draft.
      glmOssOutputs.set(e.num, art && art.trim() ? art : glmOnly.get(e.num) ?? '');
    }
    armOutputs.set('glm-oss', glmOssOutputs);

    fs.writeFileSync(`/tmp/opencode/bakeoff_${videoId}_drafts_v3.json`, JSON.stringify({
      haiku: Object.fromEntries(armOutputs.get('haiku')!),
      'glm-only': Object.fromEntries(glmOnly),
      'glm-oss': Object.fromEntries(glmOssOutputs),
    }, null, 2));

    // Judge EVERY arm (including haiku) against the full transcript.
    const dimGrades = new Map<ArmId, GradeResult[]>([
      ['haiku', []], ['glm-only', []], ['glm-oss', []],
    ]);
    for (const e of entries) {
      const grades: Partial<Record<ArmId, GradeResult>> = {};
      for (const arm of ARMS) {
        const text = armOutputs.get(arm.id)?.get(e.num) ?? '';
        if (arm.id === 'haiku') {
          // StyleParity of haiku vs itself = 100 by definition (reference).
          // FactualParity IS judged: baseline inventions get penalized here.
          const g = await judgeDimension('', e.baseline, transcript);
          grades[arm.id] = { factual: g.factual, style: 100, unsupported: g.unsupported, reasoning: `factual judged vs transcript; style=100 (self-reference, not judged)` };
        } else {
          grades[arm.id] = await judgeDimension(e.baseline, text, transcript);
        }
        console.log(`  [dim ${e.num}] ${arm.id}: ${grades[arm.id]!.factual}/${grades[arm.id]!.style} (unsup ${grades[arm.id]!.unsupported.length}) — ${grades[arm.id]!.reasoning}`);
      }
      (['haiku', 'glm-only', 'glm-oss'] as ArmId[]).forEach(id => dimGrades.get(id)!.push(grades[id]!));
      allResults.push({ videoId, dimName: `Dim ${e.num}: ${e.name}`, grades: grades as Record<ArmId, GradeResult> });
    }

    const rec = buildPerVideoRecord(videoId, transcript, dimGrades, ledger, classification);
    rec.strata.durationBucket = durationBucket(payload.videoMetadata?.duration);
    records.push(rec);
    // Incremental per-video write (no LLM work wasted on a crash).
    fs.writeFileSync(path.join(outDir, 'BAKEOFF_L2_PERVIDEO_LATEST.json'), JSON.stringify({ promptVersion: PROMPT_VERSION, records }, null, 2));
  }

  const totalSpendUsd = Object.values(ledger).reduce((a, v) => a + (v.total_cost ?? 0), 0);
  const final = writeReport(tsRun, outDir, records, allResults, classification, totalSpendUsd);
  console.log(`\n[bakeoff] ✅ Complete\n  Per-video: ${final.perVideoPath}\n  JSON: ${final.jsonPath}\n  HTML: ${final.htmlPath}`);
  const gates = JSON.parse(fs.readFileSync(path.join(outDir, 'BAKEOFF_L2_GATE_LATEST.json'), 'utf8')) as { gates: Record<string, { pass: boolean; failures: string[] }> };
  for (const [id, g] of Object.entries(gates.gates)) {
    console.log(`[gate] ${id}: ${g.pass ? 'PASS' : 'FAIL'}${g.failures.length ? ' — ' + g.failures.join('; ') : ''}`);
  }
}

main().catch(err => { console.error('[bakeoff] Fatal:', err); process.exit(1); });
