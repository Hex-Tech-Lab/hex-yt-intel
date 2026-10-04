/**
 * Phase C micro-batch bake-off (3 videos, ADR 039).
 *
 * Feeds real transcripts through the 8,000-character JEV text parser, joins
 * the hardcoded mock diarization/A-V sensors, routes with the S1-S6 fusion
 * router and prints Video ID | Expected | Actual | Match.
 *
 * Cost guard: a fixed 3-video cohort; the planned JEV call count is printed
 * and the run aborts above MAX_JEV_CALLS before any paid call is made.
 * Transcripts: fetched from the worker's POST /fetch-transcript and cached
 * under the OS temp dir, never written to the repo (ADR 012).
 *
 * Run: pnpm dlx tsx scripts/phase-c-micro-bakeoff.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  JevTextParser,
  countTurnMarkers,
  splitTranscript,
} from '../worker/src/services/sensor-fusion/heuristics/jev-text-parser';
import { routeFusion, type FusionRoute } from '../worker/src/services/sensor-fusion/matrix/fusion-router';

const WORKER_URL = process.env.WORKER_URL ?? 'https://yt-intel.hex-tech-lab.workers.dev';
const WORKER_ORIGIN = 'https://hex-yt-intel.vercel.app';
const TRANSCRIPT_DIR = nodePath.join(os.tmpdir(), 'hex-yt-intel-pool-transcripts');
const GROUND_TRUTH_FILE = 'S1_S6_POOL_GROUND_TRUTH.json';
const GROUND_TRUTH_DIRS = ['docs/architecture', 'scripts/bakeoff-inputs', 'docs/research', '.'];
const MAX_JEV_CALLS = 60;
const FETCH_TIMEOUT_MS = 90000;

/** Simulated Diarization and A/V probe outputs for the micro-batch cohort. */
interface MockSensors {
  diarizationSpeakerCount: number;
  uiFramesDetected: boolean;
  debateProsodyDetected: boolean;
}

/** Hardcoded sensor registry: only the three cohort videos. */
const MockSensorRegistry: Record<string, MockSensors> = {
  // S1 monologue (targets the S1/S6 drift)
  Z6l4HpuyyP0: { diarizationSpeakerCount: 1, uiFramesDetected: false, debateProsodyDetected: false },
  // S2 interview
  MoBr0nQtOnA: { diarizationSpeakerCount: 2, uiFramesDetected: false, debateProsodyDetected: false },
  // S3 panel (targets the S2/S3 overlap)
  '39hqY3nH5ug': { diarizationSpeakerCount: 4, uiFramesDetected: false, debateProsodyDetected: true },
};

/** Expected labels named by the cohort definition, used when the ground-truth file is not in the repo. */
const COHORT_EXPECTED: Record<string, FusionRoute> = {
  Z6l4HpuyyP0: 'S1',
  MoBr0nQtOnA: 'S2',
  '39hqY3nH5ug': 'S3',
};

const TARGET_IDS = Object.keys(MockSensorRegistry);

const OR_KEY = process.env.OPENROUTER_API_KEY;
if (!OR_KEY) {
  console.error('OPENROUTER_API_KEY not set - aborting');
  process.exit(1);
}

/** Loads expected labels for the target IDs from S1_S6_POOL_GROUND_TRUTH.json, or reports why it could not. */
const loadExpected = (): { labels: Record<string, FusionRoute>; source: string } => {
  const found = GROUND_TRUTH_DIRS.map((dir) => nodePath.join(dir, GROUND_TRUTH_FILE)).find((p) => fs.existsSync(p));
  if (!found) return { labels: COHORT_EXPECTED, source: `${GROUND_TRUTH_FILE} not found; using the cohort labels from the directive` };
  const raw = JSON.parse(fs.readFileSync(found, 'utf8')) as unknown;
  const entries = (Array.isArray(raw) ? raw : Object.entries(raw as object).map(([id, v]) => ({ ...(typeof v === 'object' ? v : { label: v }), videoId: id }))) as Array<Record<string, string>>;
  const labels: Record<string, FusionRoute> = {};
  for (const entry of entries) {
    const id = entry.videoId ?? entry.video_id ?? entry.id;
    const label = entry.expected ?? entry.label ?? entry.class ?? entry.groundTruth;
    if (TARGET_IDS.includes(id) && label) labels[id] = label as FusionRoute;
  }
  return { labels, source: found };
};

/** Cached transcript text for a video, fetched from the worker on a miss. */
const loadTranscript = async (videoId: string): Promise<string> => {
  const cachePath = nodePath.join(TRANSCRIPT_DIR, `${videoId}.txt`);
  if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath, 'utf8');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/fetch-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WORKER_ORIGIN },
      body: JSON.stringify({ videoId }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`fetch-transcript ${videoId} -> HTTP ${res.status}`);
  const body = (await res.json()) as { transcript?: string };
  if (!body.transcript) throw new Error(`fetch-transcript ${videoId}: empty transcript`);
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  fs.writeFileSync(cachePath, body.transcript);
  return body.transcript;
};

interface Row {
  videoId: string;
  expected: string;
  actual: string;
  match: boolean;
  detail: string;
}

/** Runs the micro-batch and prints the Markdown results table. */
const main = async (): Promise<void> => {
  const { labels, source } = loadExpected();
  console.log(`Ground truth: ${source}\n`);

  const transcripts = new Map<string, string>();
  for (const id of TARGET_IDS) transcripts.set(id, await loadTranscript(id));

  const plannedCalls = TARGET_IDS.reduce((sum, id) => sum + splitTranscript(transcripts.get(id) ?? '').length, 0);
  console.log(`Planned JEV calls: ${plannedCalls} (cap ${MAX_JEV_CALLS})\n`);
  if (plannedCalls > MAX_JEV_CALLS) {
    console.error('Planned JEV calls exceed the cap - aborting before any paid call');
    process.exit(1);
  }

  const parser = new JevTextParser(OR_KEY);
  const rows: Row[] = [];
  for (const id of TARGET_IDS) {
    const transcript = transcripts.get(id) ?? '';
    const expected = labels[id] ?? 'n/a';
    try {
      const text = await parser.analyze(transcript);
      const sensors = MockSensorRegistry[id];
      const result = routeFusion({
        turnMarkerCount: text.turn_marker_count,
        diarizationSpeakerCount: sensors.diarizationSpeakerCount,
        uiFramesDetected: sensors.uiFramesDetected,
        debateProsodyDetected: sensors.debateProsodyDetected,
        directAddressIntensity: text.direct_address_intensity,
        proceduralInstructionIntensity: text.procedural_instruction_intensity,
        tangentialFluffIntensity: text.tangential_fluff_intensity,
      });
      rows.push({
        videoId: id,
        expected,
        actual: result.route,
        match: result.route === expected,
        detail: `chars=${transcript.length} blocks=${splitTranscript(transcript).length} turns=${text.turn_marker_count} direct=${text.direct_address_intensity} proc=${text.procedural_instruction_intensity} fluff=${text.tangential_fluff_intensity} conf=${result.confidence.toFixed(2)}`,
      });
    } catch (error) {
      console.error(`[bakeoff] ${id} failed:`, error);
      rows.push({ videoId: id, expected, actual: 'ERROR', match: false, detail: (error as Error).message });
    }
  }

  console.log('| Video ID | Expected | Actual | Match |');
  console.log('|---|---|---|---|');
  for (const row of rows) console.log(`| ${row.videoId} | ${row.expected} | ${row.actual} | ${row.match ? 'YES' : 'NO'} |`);
  console.log(`\n${rows.filter((r) => r.match).length}/${rows.length} match\n`);
  for (const row of rows) console.log(`${row.videoId}: ${row.detail}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
