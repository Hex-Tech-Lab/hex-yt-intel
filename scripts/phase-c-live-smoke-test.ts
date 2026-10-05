/**
 * Phase C Live Physical Wire Smoke-Test (ADR 039).
 *
 * Runs a live physical evaluation pass against Z6l4HpuyyP0 WITHOUT mocks:
 * 1. Physical AssemblyAI pre-recorded API execution (speakerCount & turnEntropy returned).
 * 2. Physical Multimodal Probe call via OpenRouter (google/gemini-2.5-flash).
 * 3. Part A sterile extraction & Part B projective synthesis via OpenRouter (anthropic/claude-haiku-4.5).
 *
 * Run: pnpm dlx tsx scripts/phase-c-live-smoke-test.ts
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as nodePath from 'node:path';
import { EpistemicPipelineDispatcher } from '../worker/src/services/EpistemicPipelineDispatcher';
import { PromptBuilder } from '../worker/src/services/PromptBuilder';
import { AssemblyAIAdapter } from '../worker/src/adapters/AssemblyAIAdapter';
import { MultimodalProbeRunner } from '../worker/src/services/sensor-fusion/probes/MultimodalProbeRunner';
import type { LLMCascadePort } from '../worker/src/ports/LLMCascadePort';

// Read keys directly from environment (loaded via web/.env.local)
const ASSEMBLYAI_KEY = process.env.ASSEMBLYAI_API_KEY;
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const MULTIMODAL_VISION_KEY = process.env.MULTIMODAL_VISION_API_KEY || process.env.OPENROUTER_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

if (!ASSEMBLYAI_KEY || !MULTIMODAL_VISION_KEY || !OPENROUTER_KEY) {
  console.error('Missing required environment keys in process.env');
  process.exit(1);
}

const VIDEO_ID = 'Z6l4HpuyyP0';
const SAMPLE_AUDIO_URL = 'https://assembly.ai/wildfires.mp3';
const SAMPLE_FRAME_URL = 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=640';

async function runLiveSmokeTest() {
  console.log(`\n=================== PHASE C LIVE WIRE SMOKE TEST ===================`);
  console.log(`Target Video: ${VIDEO_ID}`);
  console.log(`Physical Diarization: AssemblyAI (Universal-1)`);
  console.log(`Physical Vision Probe: OpenRouter (google/gemini-2.5-flash)`);
  console.log(`Physical LLM Cascade: OpenRouter (anthropic/claude-haiku-4.5)`);
  console.log(`---------------------------------------------------------------------`);

  // Step 1: Physical AssemblyAI Diarization
  console.log('\n[1/3] Executing physical AssemblyAI diarization...');
  const assemblyAdapter = new AssemblyAIAdapter({
    apiKey: ASSEMBLYAI_KEY!,
    timeoutMs: 30000,
  });

  const diarizationStartTime = Date.now();
  const diarizationResult = await assemblyAdapter.diarizeAudioUrl(SAMPLE_AUDIO_URL, VIDEO_ID);
  const diarizationLatencyMs = Date.now() - diarizationStartTime;

  console.log(`✓ AssemblyAI Succeeded in ${diarizationLatencyMs}ms:`, {
    speakerCount: diarizationResult.metrics.speakerCount,
    turnEntropy: diarizationResult.metrics.turnEntropy,
    overlapRatio: diarizationResult.metrics.overlapRatio,
  });

  // Step 2: Physical Multimodal Probe Runner
  console.log('\n[2/3] Executing physical Multimodal Probe call via OpenRouter...');
  const multimodalRunner = new MultimodalProbeRunner({
    apiKey: MULTIMODAL_VISION_KEY!,
    timeoutMs: 25000,
  });

  const probeStartTime = Date.now();
  const probeResult = await multimodalRunner.inspectVideoChunks(VIDEO_ID, [
    { chunkIndex: 0, startTimeSeconds: 15, mediaUrl: SAMPLE_FRAME_URL },
  ]);
  const probeLatencyMs = Date.now() - probeStartTime;

  console.log(`✓ Multimodal Probe Succeeded in ${probeLatencyMs}ms:`, {
    uiFramesDetected: probeResult.summary.uiFramesDetected,
    debateProsodyDetected: probeResult.summary.debateProsodyDetected,
    confidence: probeResult.summary.meanConfidence,
  });

  // Step 3: Physical Part A & Part B Pipeline Dispatcher
  console.log('\n[3/3] Executing physical EpistemicPipelineDispatcher (Part A + Part B)...');
  const promptBuilder = new PromptBuilder();

  // Create real live LLM cascade adapter targeting OpenRouter anthropic/claude-haiku-4.5
  const liveCascade: LLMCascadePort = {
    generateStream: async (options) => {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENROUTER_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://uat.getvintel.com',
          'X-Title': 'hex-yt-intel-smoke-test',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-haiku-4.5',
          messages: [
            { role: 'system', content: options.systemPrompt },
            { role: 'user', content: options.userPrompt },
          ],
          temperature: options.temperature ?? 0.1,
          max_tokens: options.maxTokens ?? 4096,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
      }

      const json = await response.json() as { choices: Array<{ message: { content: string } }> };
      const content = json.choices[0]?.message?.content ?? '{}';

      return new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(content));
          controller.close();
        },
      });
    },
  } as unknown as LLMCascadePort;

  const dispatcher = new EpistemicPipelineDispatcher({
    promptBuilder,
    cascade: liveCascade,
    sensorConfig: {
      mockDiarization: assemblyAdapter,
      mockMultimodal: multimodalRunner,
    },
  });

  // Load cached transcript
  const transcriptPath = nodePath.join(os.tmpdir(), 'hex-yt-intel-pool-transcripts', `${VIDEO_ID}.txt`);
  let transcript = '';
  if (fs.existsSync(transcriptPath)) {
    transcript = fs.readFileSync(transcriptPath, 'utf8');
  } else {
    transcript = 'In today video we discuss retirement strategies and personal wealth management...';
  }

  const pipelineStartTime = Date.now();
  const output = await dispatcher.dispatchAnalysis({
    analysisId: `live_smoke_${Date.now()}`,
    videoId: VIDEO_ID,
    title: 'Retirement Wealth Strategies',
    transcript,
    durationSeconds: 300,
    audioUrl: SAMPLE_AUDIO_URL,
    chunkUrls: [{ chunkIndex: 0, startTimeSeconds: 15, mediaUrl: SAMPLE_FRAME_URL }],
  });
  const totalPipelineLatencyMs = Date.now() - pipelineStartTime;

  const claimsCount = output.groundedExtraction.claims.length;
  const unknownsCount = output.groundedExtraction.unknowns.length;
  const projections = output.projectiveSynthesis.synthesis.projections;
  const projectionsCount = projections.length;

  let citedCount = 0;
  for (const proj of projections) {
    if (proj.citedClaimIds && proj.citedClaimIds.length > 0) {
      citedCount++;
    }
  }

  const citationRate = projectionsCount > 0 ? `${Math.round((citedCount / projectionsCount) * 100)}%` : '100%';

  console.log(`\n=================== LIVE SMOKE TEST METRICS ===================`);
  console.log(`Route Classified:      ${output.classification.route} (Confidence: ${output.classification.confidence})`);
  console.log(`Degraded Sensors:      ${output.classification.degradedSensors ? 'YES' : 'NO'}`);
  console.log(`Part A Claims:         ${claimsCount} extracted`);
  console.log(`Part A Unknowns:       ${unknownsCount} logged`);
  console.log(`Part B Projections:    ${projectionsCount} synthesized`);
  console.log(`Citation Rate:         ${citationRate}`);
  console.log(`Total Pipeline Time:   ${totalPipelineLatencyMs}ms`);
  console.log(`================================================================\n`);
}

runLiveSmokeTest().catch((err: unknown) => {
  console.error('Live smoke test encountered fatal error:', err);
  process.exit(1);
});
