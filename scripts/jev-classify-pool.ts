/**
 * One-off: re-classify the 14-video bake-off pool against the S1–S6 v1
 * taxonomy (user-approved 2026-10-03) and compare with the 2026-09-26/27 POC
 * labels (scripts/bakeoff-inputs/pool_classification.json — POC saved labels
 * only, criteria text lost; override with POC_LABELS_PATH). Writes
 * docs/architecture/S1_S6_POOL_RECLASSIFICATION.json.
 *
 * Cost guard: STOP if any single call costs > $0.01 or the running total
 * would exceed $0.10 (expected ≈ $0.01 total).
 *
 * Transcripts: fetched from the worker's POST /fetch-transcript
 * (worker/src/routes/transcript.ts:17; needs the Origin header below) and
 * cached under the OS temp dir — never written to the repo (ADR 012).
 * Keys: process.env first, else a repo-relative .env.local.
 *
 * Run: pnpm dlx tsx scripts/jev-classify-pool.ts
 * Design-only — no pipeline wiring (ADR 038).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  CLASS_CODE_BY_ID,
  JEV_STRUCTURAL_CRITERIA,
  STRUCTURAL_CLASSES,
  StructuralClass,
} from '../web/lib/jev/taxonomy';

// Mirrors CURATED_VIDEO_IDS (scripts/bakeoff-l2-evaluator.ts:60) — keep in
// sync; importing the evaluator script would execute its bake-off driver.
const POOL_VIDEO_IDS = [
  'Z6l4HpuyyP0', 'ymgH8jS6Wb8', 'MoBr0nQtOnA', '_LCeJZFIsd4', 'DlNWYzaL_F0',
  'LTNVA2iP9YU', '1U8-4N1HNtU', 'yB92mx97A8s', 'gneNjQuLv88', 'GOLgLU54b5s',
  'EoKdX13w7SI', 'pjGvA-D0Fcs', 'uZ5kJ9CBbv0', '39hqY3nH5ug',
] as const;

const WORKER_URL = process.env.WORKER_URL ?? 'https://yt-intel.hex-tech-lab.workers.dev';
const WORKER_ORIGIN = 'https://hex-yt-intel.vercel.app';
const TRANSCRIPT_DIR = nodePath.join(os.tmpdir(), 'hex-yt-intel-pool-transcripts');
const POC_PATH = process.env.POC_LABELS_PATH ?? 'docs/architecture/S1_S6_POOL_GROUND_TRUTH.json';
const OUT_PATH = 'docs/architecture/S1_S6_POOL_RECLASSIFICATION.json';
const MAX_CALL_COST = 0.01;
const MAX_TOTAL_COST = 0.1;

type PocEntry = { class: string; multiSpeaker?: number; inventRisk?: number };
type Rec = {
  videoId: string;
  pocClass: string | null;
  newClass: string | null;
  agree: boolean | null;
  multiSpeakerPoc: number | null;
  multiSpeakerNew: number | null;
  inventRiskPoc: number | null;
  inventRiskNew: number | null;
  costUsd: number;
  skippedReason?: string;
};

const env: Record<string, string> = {};
const envPath = ['.env.local', 'web/.env.local'].find((p) => fs.existsSync(p));
if (envPath) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const OR_KEY = process.env.OPENROUTER_API_KEY ?? env['OPENROUTER_API_KEY'];
if (!OR_KEY) {
  console.error('OPENROUTER_API_KEY not set (process.env or a repo-relative .env.local) — aborting');
  process.exit(1);
}

/** Cached transcript text for a video, fetched from the worker on a miss; null when the worker has none. */
async function loadTranscript(videoId: string): Promise<string | null> {
  const cachePath = nodePath.join(TRANSCRIPT_DIR, `${videoId}.txt`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');
  const res = await timedFetch(
    `${WORKER_URL}/fetch-transcript`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WORKER_ORIGIN },
      body: JSON.stringify({ videoId }),
    },
    90000,
  );
  if (!res.ok) {
    console.warn(`[classify] fetch-transcript ${videoId} → HTTP ${res.status}`);
    return null;
  }
  const body = (await res.json()) as { transcript?: string };
  if (!body.transcript) return null;
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  fs.writeFileSync(cachePath, body.transcript);
  return body.transcript;
}

const poc: Record<string, PocEntry> = JSON.parse(fs.readFileSync(POC_PATH, 'utf8'));

/** Decisions API shape verified against worker/src/services/JevCommentClassifier.ts (live-checked 2026-09-30). */
async function jevDecisions(state: Record<string, unknown>, questions: Record<string, unknown>): Promise<{
  answers?: Record<string, { choice?: string; noul?: number; score?: number; confidence?: number }>;
  usage?: { cost?: number };
}> {
  const res = await timedFetch(
    'https://openrouter.ai/api/alpha/decisions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OR_KEY}`,
        'Content-Type': 'application/json',
        'X-Title': 'hex-yt-intel/jev-classify-pool',
      },
      body: JSON.stringify({ model: '~typesafe/jev-latest', state, questions }),
    },
    60000,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${clip(await res.text(), 200)}`);
  return (await res.json()) as {
    answers?: Record<string, { choice?: string; noul?: number; score?: number; confidence?: number }>;
    usage?: { cost?: number };
  };
}

/** Truncate with an ellipsis so clipped text is never silently incomplete. */
const clip = (text: string, max: number) => text.length > max ? `${text.slice(0, max)}...` : text;

/** fetch with a hard deadline; the timer is always released. */
async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

const to9 = (risk0to100: number) => Math.max(0, Math.min(9, (risk0to100 / 100) * 9));

const questions = {
  structural_class: {
    type: 'choice',
    instructions:
      'Analyze this document strictly through its textual flow, semantic structure, turn-taking markers (>>), and typographic formatting. Do not infer audio, video, or production quality. Classify it into exactly one structural class.',
    criteria: { ...JEV_STRUCTURAL_CRITERIA },
  },
  multi_speaker: {
    type: 'noul',
    instructions:
      'Does the transcript text contain explicit structural dialogue tags or alternating Q&A formatting (turn markers such as ">>", question-and-answer exchanges), as opposed to one continuous narrative flow? Judge from the transcript text alone.',
    criteria: {
      true: 'Explicit structural dialogue tags or alternating Q&A formatting are present',
      false: 'One continuous narrative flow with no turn markers or Q&A exchanges',
    },
  },
  extrapolation_risk: {
    type: 'score',
    instructions:
      'How many abrupt semantic context shifts lacking conversational flow does the transcript text contain, such that analysis extrapolating beyond the stated words risks inventing facts? 0 = low risk, 9 = extreme risk.',
    criteria: [
      'Grade 0 — Coherent text flow; everything needed is in the words',
      'Grade 3 — Occasional abrupt context shifts, minor risk',
      'Grade 6 — Frequent abrupt context shifts; meaning unclear from the words alone',
      'Grade 9 — Disjointed fragments with no conversational bridging',
    ],
  },
};

let totalCost = 0;
const records: Rec[] = [];
const missing: string[] = [];

for (const id of POOL_VIDEO_IDS) {
  const pocEntry = poc[id] ?? null;
  const rawTranscript = await loadTranscript(id);
  if (rawTranscript === null) {
    missing.push(id);
    records.push({
      videoId: id,
      pocClass: pocEntry ? pocEntry.class : null,
      newClass: null,
      agree: null,
      multiSpeakerPoc: pocEntry?.multiSpeaker ?? null,
      multiSpeakerNew: null,
      inventRiskPoc: pocEntry?.inventRisk ?? null,
      inventRiskNew: null,
      costUsd: 0,
      skippedReason: 'worker /fetch-transcript returned no transcript',
    });
    continue;
  }

  const transcript = clip(rawTranscript.replace(/\s+/g, ' ').trim(), 24000);
  const call = await jevDecisions({ transcript }, questions);
  const cost = call.usage?.cost ?? 0;
  if (cost > MAX_CALL_COST) {
    console.error(`STOP: call for ${id} cost $${cost} > $${MAX_CALL_COST} cap`);
    process.exit(2);
  }
  if (totalCost + cost > MAX_TOTAL_COST) {
    console.error(`STOP: running total $${(totalCost + cost).toFixed(4)} would exceed $${MAX_TOTAL_COST} cap`);
    process.exit(2);
  }
  totalCost += cost;

  const clsAnswer = call.answers?.structural_class?.choice;
  const newId = STRUCTURAL_CLASSES.find((c) => c === clsAnswer || CLASS_CODE_BY_ID[c] === clsAnswer) ?? null;
  const multi = call.answers?.multi_speaker?.noul;
  const riskRaw = call.answers?.extrapolation_risk?.score;

  const pocCode = pocEntry?.class ?? null;
  const newCode = newId ? CLASS_CODE_BY_ID[newId as StructuralClass] : null;
  records.push({
    videoId: id,
    pocClass: pocCode,
    newClass: newCode,
    agree: newCode !== null && pocCode !== null ? newCode === pocCode : null,
    multiSpeakerPoc: pocEntry?.multiSpeaker ?? null,
    multiSpeakerNew: typeof multi === 'number' ? Number(multi.toFixed(2)) : null,
    inventRiskPoc: pocEntry?.inventRisk ?? null,
    inventRiskNew: typeof riskRaw === 'number' ? Number(to9(riskRaw).toFixed(2)) : null,
    costUsd: Number(cost.toFixed(6)),
  });
  console.log(
    `${id}: poc=${pocCode} new=${newCode} agree=${records.at(-1)?.agree} multi=${multi} risk9=${riskRaw} cost=$${cost}`,
  );
}

const classified = records.filter((r) => r.newClass !== null);
const agreeCount = classified.filter((r) => r.agree === true).length;
const disagreements = classified.filter((r) => r.agree === false);
const summary = {
  generatedAt: new Date().toISOString(),
  poolSize: POOL_VIDEO_IDS.length,
  videosClassified: classified.length,
  skipped: missing,
  agreement: `${agreeCount}/${classified.length}`,
  agreementPct: Math.round((agreeCount / Math.max(1, classified.length)) * 100),
  disagreements: disagreements.map((r) => ({
    videoId: r.videoId,
    pocClass: r.pocClass,
    newClass: r.newClass,
    multiSpeakerPoc: r.multiSpeakerPoc,
    multiSpeakerNew: r.multiSpeakerNew,
  })),
  multiSpeakerDelta: classified.filter((r) => r.multiSpeakerNew !== null).map((r) => ({
    videoId: r.videoId,
    poc: r.multiSpeakerPoc,
    new: r.multiSpeakerNew,
    absDelta: r.multiSpeakerNew !== null && r.multiSpeakerPoc !== null
      ? Number(Math.abs(r.multiSpeakerNew - r.multiSpeakerPoc).toFixed(2))
      : null,
  })),
  inventRiskDelta: classified.filter((r) => r.inventRiskNew !== null).map((r) => ({
    videoId: r.videoId,
    poc: r.inventRiskPoc,
    new: r.inventRiskNew,
    absDelta: r.inventRiskNew !== null && r.inventRiskPoc !== null
      ? Number(Math.abs(r.inventRiskNew - r.inventRiskPoc).toFixed(2))
      : null,
  })),
  totalCostUsd: Number(totalCost.toFixed(4)),
  records,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2) + '\n');
console.log(`\nWrote ${OUT_PATH}`);
console.log(`agreement: ${summary.agreement} (${summary.agreementPct}%) of ${classified.length} classified; skipped: ${missing.join(', ') || 'none'}`);
console.log(`total cost: $${summary.totalCostUsd}`);
if (disagreements.length) {
  console.log('disagreements:');
  for (const d of disagreements) console.log(`  ${d.videoId}: poc=${d.pocClass} new=${d.newClass}`);
}
