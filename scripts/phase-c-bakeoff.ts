/**
 * Phase C 14-video bake-off (ADR 039).
 *
 * Feeds real transcripts through the 8,000-character JEV text parser, joins
 * hardcoded MOCK diarization/A-V sensors, routes with the S1-S6 fusion router
 * and prints Video ID | Expected | Actual | Match, the agreement percentage
 * and the total JEV chunk calls.
 *
 * Ground truth: the human hand labels below are the sole source (the POC
 * labels are deprecated; S1_S6_POOL_GROUND_TRUTH.json is not in the repo).
 * The mock sensors are set to match each video's label, so S1/S2/S3 agreement
 * is partly decided by the mocks; only turn markers and JEV scores are real.
 *
 * Cost guard: the planned JEV call count is printed and the run aborts above
 * MAX_JEV_CALLS before any paid call is made.
 * Transcripts: fetched from the worker's POST /fetch-transcript and cached
 * under the OS temp dir, never written to the repo (ADR 012).
 *
 * Run: set -a; source web/.env.local; set +a; pnpm dlx tsx scripts/phase-c-bakeoff.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  JevTextParser,
  splitTranscript,
} from '../worker/src/services/sensor-fusion/heuristics/jev-text-parser';
import { routeFusion, type FusionRoute } from '../worker/src/services/sensor-fusion/matrix/fusion-router';

const WORKER_URL = process.env.WORKER_URL ?? 'https://yt-intel.hex-tech-lab.workers.dev';
const WORKER_ORIGIN = 'https://hex-yt-intel.vercel.app';
const TRANSCRIPT_DIR = nodePath.join(os.tmpdir(), 'hex-yt-intel-pool-transcripts');
const MAX_JEV_CALLS_RAW = process.env.MAX_JEV_CALLS ?? '200';
if (!Number.isFinite(Number(MAX_JEV_CALLS_RAW))) {
  console.error(`MAX_JEV_CALLS must be a number (got "${MAX_JEV_CALLS_RAW}") - aborting before any paid call`);
  process.exit(1);
}
const MAX_JEV_CALLS = Number(MAX_JEV_CALLS_RAW);
const FETCH_TIMEOUT_MS = 90000;

/** Simulated Diarization and A/V probe outputs. */
interface MockSensors {
  diarizationSpeakerCount: number;
  uiFramesDetected: boolean;
  debateProsodyDetected: boolean;
}

/** Human hand-labeled ground truth for the 14-video pool (immutable). */
const GROUND_TRUTH: Record<string, FusionRoute> = {
  Z6l4HpuyyP0: 'S1',
  '1U8-4N1HNtU': 'S1',
  EoKdX13w7SI: 'S1',
  'gneNjQuLv88': 'S1',
  GOLgLU54b5s: 'S1',
  'pjGvA-D0Fcs': 'S1',
  uZ5kJ9CBbv0: 'S1',
  ymgH8jS6Wb8: 'S1',
  MoBr0nQtOnA: 'S2',
  _LCeJZFIsd4: 'S2',
  DlNWYzaL_F0: 'S2',
  LTNVA2iP9YU: 'S2',
  '39hqY3nH5ug': 'S3',
  yB92mx97A8s: 'S3',
};

const MOCK_S1: MockSensors = { diarizationSpeakerCount: 1, uiFramesDetected: false, debateProsodyDetected: false };
const MOCK_S2: MockSensors = { diarizationSpeakerCount: 2, uiFramesDetected: false, debateProsodyDetected: false };
const MOCK_S3: MockSensors = { diarizationSpeakerCount: 4, uiFramesDetected: false, debateProsodyDetected: true };

/** Mock sensor registry: one entry per pool video, matching its hand label. */
const MockSensorRegistry: Record<string, MockSensors> = Object.fromEntries(
  Object.entries(GROUND_TRUTH).map(([id, label]) => [id, label === 'S1' ? MOCK_S1 : label === 'S2' ? MOCK_S2 : MOCK_S3]),
);

const TARGET_IDS = Object.keys(GROUND_TRUTH);

const OR_KEY = process.env.OPENROUTER_API_KEY;
if (!OR_KEY) {
  console.error('OPENROUTER_API_KEY not set - aborting');
  process.exit(1);
}

/** Cached transcript text for a video, fetched from the worker on a miss.
 *  Stale cache entries from a previous pool refresh can be cleared by running
 *  with PHASE_C_CLEAR_TRANSCRIPT_CACHE=1 (tmpdir is OS-managed, so this
 *  script never deletes them automatically). */
const loadTranscript = async (videoId: string): Promise<string> => {
  const cachePath = nodePath.join(TRANSCRIPT_DIR, `${videoId}.txt`);
  if (process.env.PHASE_C_CLEAR_TRANSCRIPT_CACHE === '1' && fs.existsSync(TRANSCRIPT_DIR)) {
    fs.rmSync(TRANSCRIPT_DIR, { recursive: true, force: true });
  }
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

/** Runs the bake-off and prints the Markdown results table. */
const main = async (): Promise<void> => {
  const transcripts = new Map<string, string>();
  const loadErrors = new Map<string, string>();
  for (const id of TARGET_IDS) {
    try {
      transcripts.set(id, await loadTranscript(id));
    } catch (error) {
      console.error(`[bakeoff] transcript ${id} failed:`, error);
      loadErrors.set(id, (error as Error).message);
    }
  }

  const plannedCalls = [...transcripts.values()].reduce((sum, text) => sum + splitTranscript(text).length, 0);
  console.log(`Planned JEV calls: ${plannedCalls} (cap ${MAX_JEV_CALLS})\n`);
  if (plannedCalls > MAX_JEV_CALLS) {
    console.error('Planned JEV calls exceed the cap - aborting before any paid call');
    process.exit(1);
  }

  const parser = new JevTextParser(OR_KEY);
  const rows: Row[] = [];
  let jevCalls = 0;
  for (const id of TARGET_IDS) {
    const expected = GROUND_TRUTH[id];
    const transcript = transcripts.get(id);
    if (transcript === undefined) {
      rows.push({ videoId: id, expected, actual: 'ERROR', match: false, detail: loadErrors.get(id) ?? 'no transcript' });
      continue;
    }
    try {
      const blocks = splitTranscript(transcript).length;
      const text = await parser.analyze(transcript);
      jevCalls += blocks;
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
        detail: `chars=${transcript.length} blocks=${blocks} turns=${text.turn_marker_count} direct=${text.direct_address_intensity} proc=${text.procedural_instruction_intensity} fluff=${text.tangential_fluff_intensity} conf=${result.confidence.toFixed(2)}`,
      });
    } catch (error) {
      console.error(`[bakeoff] ${id} failed:`, error);
      rows.push({ videoId: id, expected, actual: 'ERROR', match: false, detail: (error as Error).message });
    }
  }

  console.log('| Video ID | Expected | Actual | Match |');
  console.log('|---|---|---|---|');
  for (const row of rows) console.log(`| ${row.videoId} | ${row.expected} | ${row.actual} | ${row.match ? 'YES' : 'NO'} |`);
  const matches = rows.filter((r) => r.match).length;
  console.log(`\nAgreement: ${matches}/${rows.length} = ${((matches / rows.length) * 100).toFixed(1)}%`);
  console.log(`Total JEV chunk calls: ${jevCalls}\n`);
  for (const row of rows) console.log(`${row.videoId}: ${row.detail}`);

  const failedRows = rows.filter((r) => !r.match);
  if (failedRows.length > 0) {
    console.error(`Bake-off FAILED: ${failedRows.length}/${rows.length} rows did not match ground truth`);
    process.exit(1);
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
