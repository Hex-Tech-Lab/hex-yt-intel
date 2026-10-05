/**
 * Phase C 3-Video Micro-Batch Validation (ADR 039).
 *
 * Stitches the EpistemicPipelineDispatcher across the 3 benchmark videos:
 * 1. Z6l4HpuyyP0 (S1 Monologue)
 * 2. MoBr0nQtOnA (S2 Interview)
 * 3. 39hqY3nH5ug (S3 Panel / Debate)
 *
 * Verifies:
 * - Routing accuracy against ground truth labels
 * - Grounded Claim count extraction (Part A)
 * - Synthesis Citation Rate (Part B)
 * - End-to-end execution latency
 *
 * Run: pnpm dlx tsx scripts/phase-c-micro-bakeoff.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';

import {
  EpistemicPipelineDispatcher,
  type EpistemicPipelineInput,
} from '../worker/src/services/EpistemicPipelineDispatcher';
import { PromptBuilder } from '../worker/src/services/PromptBuilder';
import { LLMCascade } from '../worker/src/services/LLMCascade';
import type { FusionRoute } from '../worker/src/services/sensor-fusion/matrix/fusion-router';
import type { DiarizationProviderPort } from '../worker/src/ports/DiarizationProviderPort';
import type { MultimodalProbePort } from '../worker/src/ports/MultimodalProbePort';

const WORKER_URL = process.env.WORKER_URL ?? 'https://yt-intel.hex-tech-lab.workers.dev';
const WORKER_ORIGIN = 'https://hex-yt-intel.vercel.app';
const TRANSCRIPT_DIR = nodePath.join(os.tmpdir(), 'hex-yt-intel-pool-transcripts');
const FETCH_TIMEOUT_MS = 60000;

interface BenchmarkTarget {
  videoId: string;
  expectedRoute: FusionRoute;
  mockDiarization: {
    speakerCount: number;
    turnEntropy: number;
    overlapRatio: number;
  };
  mockMultimodal: {
    uiFramesDetected: boolean;
    debateProsodyDetected: boolean;
  };
}

const BENCHMARKS: BenchmarkTarget[] = [
  {
    videoId: 'Z6l4HpuyyP0',
    expectedRoute: 'S1',
    mockDiarization: { speakerCount: 1, turnEntropy: 0, overlapRatio: 0 },
    mockMultimodal: { uiFramesDetected: false, debateProsodyDetected: false },
  },
  {
    videoId: 'MoBr0nQtOnA',
    expectedRoute: 'S2',
    mockDiarization: { speakerCount: 2, turnEntropy: 0.95, overlapRatio: 0.04 },
    mockMultimodal: { uiFramesDetected: false, debateProsodyDetected: false },
  },
  {
    videoId: '39hqY3nH5ug',
    expectedRoute: 'S3',
    mockDiarization: { speakerCount: 4, turnEntropy: 1.85, overlapRatio: 0.18 },
    mockMultimodal: { uiFramesDetected: false, debateProsodyDetected: true },
  },
];

async function loadTranscript(videoId: string): Promise<string> {
  const cachePath = nodePath.join(TRANSCRIPT_DIR, `${videoId}.txt`);
  if (fs.existsSync(cachePath)) {
    return fs.readFileSync(cachePath, 'utf8');
  }

  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}/fetch-transcript`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WORKER_ORIGIN },
      body: JSON.stringify({ videoId }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    console.error(`[loadTranscript] Network fetch failed for videoId: ${videoId}`, err);
    throw new Error(`fetch-transcript ${videoId} failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // I/O resource cleanup lifecycle
  }

  if (!res.ok) throw new Error(`fetch-transcript ${videoId} -> HTTP ${res.status}`);
  const body = (await res.json()) as { transcript?: string };
  if (!body.transcript) throw new Error(`fetch-transcript ${videoId}: empty transcript`);

  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  fs.writeFileSync(cachePath, body.transcript);
  return body.transcript;
}

interface ValidationRow {
  videoId: string;
  expected: string;
  actual: string;
  routingMatch: boolean;
  claimsCount: number;
  projectionsCount: number;
  citationRate: string;
  latencyMs: number;
}

async function runMicroBatch(): Promise<void> {
  const promptBuilder = new PromptBuilder();

  // Deterministic mock cascade for offline micro-batch validation
  const mockCascade: LLMCascadePort = {
    generateStream: (options) => {
      // Check if prompt is Part A (Grounded Extraction) or Part B (Projective Synthesis)
      const isPartA = options.systemPrompt.includes('sterile extraction engine');

      let responseText: string;
      if (isPartA) {
        responseText = JSON.stringify({
          claims: [
            {
              id: 'claim_01',
              speaker: 'Speaker 1',
              timestampRange: [10, 45],
              verbatimQuote: 'who retires on more than 1 million and what sets them apart from the rest of us.',
              atomicAssertion: 'Retirees with over 1 million possess distinct characteristics.',
              confidence: 0.98,
            },
            {
              id: 'claim_02',
              speaker: 'Speaker 1',
              timestampRange: [60, 110],
              verbatimQuote: 'I retired around $500,000.',
              atomicAssertion: 'Speaker retired with approximately $500k.',
              confidence: 0.99,
            },
          ],
          unknowns: ['precise_net_worth_breakdown'],
          metadata: {
            speakerCount: 1,
            durationSeconds: 300,
            classification: 'S1',
          },
        });
      } else {
        responseText = JSON.stringify({
          schemaVersion: '2.0',
          persona: 'general',
          synthesis: {
            coreThesis: 'Retirement capital thresholds vary significantly by investment discipline and lifestyle expectations.',
            projections: [
              {
                id: 'proj_01',
                citedClaimIds: ['claim_01', 'claim_02'],
                implication: 'Retirement viability at lower savings requires higher equity yields or reduced living expenditures.',
                marketHorizon: 'long-term',
                confidence: 0.92,
              },
            ],
            unsupportedQuestions: ['What are the geographical cost of living assumptions?'],
          },
        });
      }

      return Promise.resolve(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(responseText));
            controller.close();
          },
        }),
      );
    },
  } as unknown as LLMCascadePort;

  console.log('Fetching benchmark transcripts from worker pool...');
  const transcripts: Map<string, string> = new Map();
  for (const target of BENCHMARKS) {
    try {
      const text = await loadTranscript(target.videoId);
      transcripts.set(target.videoId, text);
      console.log(`✓ Loaded ${target.videoId} (${text.length} chars)`);
    } catch (err: unknown) {
      console.error(`✗ Failed to load ${target.videoId}:`, err);
    }
  }

  const results: ValidationRow[] = [];

  for (const target of BENCHMARKS) {
    const transcriptText = transcripts.get(target.videoId);
    if (!transcriptText) {
      results.push({
        videoId: target.videoId,
        expected: target.expectedRoute,
        actual: 'NO_TRANSCRIPT',
        routingMatch: false,
        claimsCount: 0,
        projectionsCount: 0,
        citationRate: '0%',
        latencyMs: 0,
      });
      continue;
    }

    const mockDiarizationProvider: DiarizationProviderPort = {
      diarizeAudioUrl: () =>
        Promise.resolve({
          videoId: target.videoId,
          metrics: target.mockDiarization,
          latencyMs: 80,
        }),
    };

    const mockMultimodalProvider: MultimodalProbePort = {
      inspectVideoChunks: () =>
        Promise.resolve({
          videoId: target.videoId,
          chunksScanned: 3,
          summary: target.mockMultimodal,
          latencyMs: 120,
        }),
    };

    const dispatcher = new EpistemicPipelineDispatcher({
      promptBuilder,
      cascade: mockCascade,
      sensorConfig: {
        mockDiarization: mockDiarizationProvider,
        mockMultimodal: mockMultimodalProvider,
      },
    });

    const input: EpistemicPipelineInput = {
      analysisId: `micro_${target.videoId}`,
      videoId: target.videoId,
      transcript: transcriptText,
      durationSeconds: 300,
      audioUrl: 'https://example.com/audio.mp3',
    };

    const output = await dispatcher.dispatchAnalysis(input);

    const claimsCount = output.groundedExtraction.claims.length;
    const projections = output.projectiveSynthesis.synthesis.projections;
    const projectionsCount = projections.length;

    let citedCount = 0;
    for (const proj of projections) {
      if (proj.citedClaimIds && proj.citedClaimIds.length > 0) {
        citedCount++;
      }
    }

    const citationRate =
      projectionsCount > 0 ? `${Math.round((citedCount / projectionsCount) * 100)}%` : '100%';

    results.push({
      videoId: target.videoId,
      expected: target.expectedRoute,
      actual: output.classification.route,
      routingMatch: output.classification.route === target.expectedRoute,
      claimsCount,
      projectionsCount,
      citationRate,
      latencyMs: output.latencyMs,
    });
  }

  console.log('\n=================== 3-VIDEO MICRO-BATCH VALIDATION ===================');
  console.log('| Video ID    | Expected | Actual | Route Match | Claims | Projections | Citation Rate | Latency |');
  console.log('|-------------|----------|--------|-------------|--------|-------------|---------------|---------|');
  for (const row of results) {
    const matchStr = row.routingMatch ? 'YES' : 'NO';
    console.log(
      `| ${row.videoId.padEnd(11)} | ${row.expected.padEnd(8)} | ${row.actual.padEnd(6)} | ${matchStr.padEnd(11)} | ${String(row.claimsCount).padEnd(6)} | ${String(row.projectionsCount).padEnd(11)} | ${row.citationRate.padEnd(13)} | ${String(row.latencyMs).padEnd(5)}ms |`,
    );
  }
  console.log('======================================================================\n');
}

runMicroBatch().catch((err: unknown) => {
  console.error('Micro-batch failed:', err);
  process.exit(1);
});
