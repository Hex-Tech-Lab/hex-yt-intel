#!/usr/bin/env -S pnpm dlx tsx
/**
 * Real, permanent, version-controlled UCIS parity-test judge harness.
 *
 * WHY THIS FILE EXISTS (read before touching this): every prior 2026-08-18
 * parity-test round (see docs/research/2026-08-18-full-dimension-parity-batch-test.md
 * §§8-10) built its judge/scoring logic as a scratch script, deleted it after
 * the run, and reconstructed it from a prose description next round. That
 * caused real, measured judge-calibration drift — the identical [1,10]
 * bundle output scored 100.0 under §8/§9's judge and only 47.5 under §10's
 * from-scratch-rebuilt judge, silently invalidating cross-round comparisons
 * on a cohort that had already spent ~$3.14. This script is the fix: a real,
 * committed, re-runnable judge using a FIXED, WRITTEN-DOWN judge prompt
 * (docs/research/parity-test-harness/judge-prompt.ts) and a FIXED,
 * WRITTEN-DOWN required-subsections list (docs/research/parity-test-harness/required-subsections.ts).
 *
 * RULE: all future parity-test rounds MUST call this exact script (or import
 * its `judgeBundlePair` function) rather than regenerating judge logic ad
 * hoc. See README.md in this directory.
 *
 * USAGE (single pair):
 *   OPENROUTER_API_KEY=... pnpm dlx tsx docs/research/parity-test-harness/judge.ts \
 *     --dims 1,10 --candidate path/to/candidate.txt --groundTruth path/to/truth.txt
 *
 * USAGE (batch, proof-of-work mode against a saved round file):
 *   OPENROUTER_API_KEY=... pnpm dlx tsx docs/research/parity-test-harness/judge.ts \
 *     --roundFile docs/research/2026-08-18-round10-results/round_b110_r1_guardrail.json \
 *     --groundTruthFile docs/research/2026-08-18-round10-results/haiku_new_videos.json \
 *     --videos fr,zh --videoIdKey fr=gCU0n6H_MXo,zh=ctR1jrI42uc \
 *     --out docs/research/parity-test-harness/proof-run-output.json
 */

import fs from 'fs';
import path from 'path';
import {
  JUDGE_SYSTEM_PROMPT,
  JUDGE_PROMPT_VERSION,
  buildJudgeUserMessage,
} from './judge-prompt';
import { requiredSubsectionsForBundle } from './required-subsections';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const JUDGE_MODEL = 'anthropic/claude-haiku-4.5';

export interface JudgeResult {
  structural_completeness: number;
  factual_coverage: number;
  missing_subsections: string[];
  judge_prompt_version: string;
  judge_model: string;
}

/** Real deterministic judge call: temperature 0, fixed prompt, fixed checklist. */
export async function judgeBundlePair(params: {
  dims: number[];
  candidateOutput: string;
  groundTruthOutput: string;
}): Promise<JudgeResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY not set in environment');
  }
  const requiredSubsections = requiredSubsectionsForBundle(params.dims);
  const userMessage = buildJudgeUserMessage({
    dims: params.dims,
    requiredSubsections,
    candidateOutput: params.candidateOutput,
    groundTruthOutput: params.groundTruthOutput,
  });

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
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

  const data = (await res.json()) as any;
  const raw: string = data?.choices?.[0]?.message?.content ?? '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Judge response had no parseable JSON: ${raw.slice(0, 500)}`);
  }
  const parsed = JSON.parse(match[0]);

  return {
    structural_completeness: Number(parsed.structural_completeness) || 0,
    factual_coverage: Number(parsed.factual_coverage) || 0,
    missing_subsections: Array.isArray(parsed.missing_subsections)
      ? parsed.missing_subsections
      : [],
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    judge_model: JUDGE_MODEL,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      out[key] = value;
      if (value !== 'true') i++;
    }
  }
  return out;
}

async function runSinglePair(args: Record<string, string>) {
  const dims = args.dims.split(',').map((d) => parseInt(d.trim(), 10));
  const candidateOutput = fs.readFileSync(args.candidate, 'utf-8');
  const groundTruthOutput = fs.readFileSync(args.groundTruth, 'utf-8');
  const result = await judgeBundlePair({ dims, candidateOutput, groundTruthOutput });
  console.log(JSON.stringify(result, null, 2));
}

/**
 * Proof-of-work batch mode: judges a real saved round file's GPT-OSS-120B
 * outputs against a real saved Haiku-4.5 ground-truth file, for the video(s)
 * that exist in both real, on-disk artifacts (fr=gCU0n6H_MXo and
 * zh=ctR1jrI42uc are the two videos with a clean fresh Haiku baseline saved
 * in haiku_new_videos.json, per §10's own round10-results directory).
 */
async function runRoundFileBatch(args: Record<string, string>) {
  const roundData = JSON.parse(fs.readFileSync(args.roundFile, 'utf-8'));
  const groundTruthData = JSON.parse(fs.readFileSync(args.groundTruthFile, 'utf-8'));
  const dims: number[] = roundData.dims;
  const videos: string[] = args.videos.split(',');
  const videoIdMap: Record<string, string> = {};
  for (const pair of args.videoIdKey.split(',')) {
    const [k, v] = pair.split('=');
    videoIdMap[k] = v;
  }

  const results: Record<string, JudgeResult & { video_id: string }> = {};
  for (const lang of videos) {
    const perVideo = roundData.perVideo[lang];
    if (!perVideo) {
      console.error(`No candidate output for lang=${lang} in round file, skipping`);
      continue;
    }
    const dimsKey = dims.join('_');
    const gtKey = `${videoIdMap[lang]}_${dimsKey}`;
    const gt = groundTruthData[gtKey];
    if (!gt) {
      console.error(`No ground truth for key=${gtKey}, skipping`);
      continue;
    }
    console.error(`Judging lang=${lang} video=${perVideo.video_id} dims=[${dims.join(',')}]...`);
    const result = await judgeBundlePair({
      dims,
      candidateOutput: perVideo.gen_text,
      groundTruthOutput: gt.text,
    });
    results[lang] = { ...result, video_id: perVideo.video_id };
    console.error(
      `  -> structural_completeness=${result.structural_completeness} factual_coverage=${result.factual_coverage}`
    );
  }

  const output = {
    harness: 'docs/research/parity-test-harness/judge.ts',
    judge_prompt_version: JUDGE_PROMPT_VERSION,
    round_file: args.roundFile,
    ground_truth_file: args.groundTruthFile,
    dims,
    run_at: new Date().toISOString(),
    results,
  };

  if (args.out) {
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, JSON.stringify(output, null, 2));
    console.error(`Wrote ${args.out}`);
  } else {
    console.log(JSON.stringify(output, null, 2));
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.roundFile) {
    await runRoundFileBatch(args);
  } else if (args.candidate && args.groundTruth) {
    await runSinglePair(args);
  } else {
    console.error(
      'Usage: judge.ts --dims 1,10 --candidate <file> --groundTruth <file>\n' +
        '   or: judge.ts --roundFile <round.json> --groundTruthFile <haiku.json> --videos fr,zh --videoIdKey fr=gCU0n6H_MXo,zh=ctR1jrI42uc [--out <file>]'
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
