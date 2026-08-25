# UCIS Parity-Test Judge Harness

**Status**: real, committed, run-once-proved (2026-08-18).

## Why this exists

Every prior GPT-OSS-120B vs Haiku 4.5 UCIS parity-test round in this project
(`docs/research/2026-08-18-full-dimension-parity-batch-test.md` §§8-10) built
its judge/scoring logic as a scratch script, never committed it, and
reconstructed the judge prompt and required-subsections checklist from a
prose description at the start of the next round. That caused real,
measured **judge-calibration drift**: the identical `[1,10]` bundle output
scored `100.0/100` under §8/§9's judge and only `47.5/100` under §10's
from-scratch-rebuilt judge — with no code change and no real prompt
regression in between. This silently invalidated every cross-round
comparison in that test cohort (~$3.14 spent on results that turned out not
to be comparable to each other), and it had already happened once before
this round without being fixed.

**Rule, going forward, no exceptions**: every future parity-test round MUST
use this exact committed harness. Never regenerate the judge prompt or the
required-subsections checklist ad hoc, from memory, or from a prose summary.
If the judge genuinely needs to change, edit `judge-prompt.ts` in this
directory, bump `JUDGE_PROMPT_VERSION`, and treat any comparison across
versions as non-comparable (flag it explicitly, the same way §10 flagged its
own drift) rather than presenting new numbers next to old ones.

## Files

- `judge-prompt.ts` — the fixed, written-down judge system prompt and
  user-message builder. This is THE judge; it does not get re-derived.
- `required-subsections.ts` — the real per-dimension required-subsections
  checklist, extracted verbatim from `web/lib/prompts/ucis-v5.3.ts`
  (dimensions 1-11), plus the real production `STREAM_BUNDLES` groupings
  from `web/lib/config/synthesis.ts`.
- `judge.ts` — the runnable harness. Exports `judgeBundlePair()` for
  programmatic use, and a CLI for direct invocation.
- `proof-run-output.json` — real output from the proof run described below,
  kept as evidence the harness actually works, not just that it was written.

## Inputs / outputs

`judgeBundlePair({ dims, candidateOutput, groundTruthOutput })`:

- **dims**: the dimension numbers in the bundle, e.g. `[1, 10]`.
- **candidateOutput**: the model-under-test's raw bundle output text (e.g. a
  GPT-OSS-120B generation).
- **groundTruthOutput**: the reference model's raw bundle output text for the
  *same video, same dims* (production ground truth is Haiku 4.5).

Returns a `JudgeResult`:

```json
{
  "structural_completeness": 83,
  "factual_coverage": 62,
  "missing_subsections": ["D10: 10.2 Domain-Specific Risk Disclosures"],
  "judge_prompt_version": "1.0.0",
  "judge_model": "anthropic/claude-haiku-4.5"
}
```

The judge call is `anthropic/claude-haiku-4.5` at `temperature: 0` via
OpenRouter — deterministic scoring is asked of the judge explicitly in the
system prompt, and pinning the model/version/prompt here is what makes
scores comparable round over round.

## How to run it

Single pair, from files on disk:

```bash
set -a; source web/.env.local; set +a
pnpm dlx tsx docs/research/parity-test-harness/judge.ts \
  --dims 1,10 \
  --candidate path/to/candidate-output.txt \
  --groundTruth path/to/haiku-ground-truth.txt
```

Batch mode, against a saved round file + ground-truth file (the shape used
by `docs/research/2026-08-18-round10-results/*.json` and
`haiku_new_videos.json`):

```bash
set -a; source web/.env.local; set +a
pnpm dlx tsx docs/research/parity-test-harness/judge.ts \
  --roundFile docs/research/2026-08-18-round10-results/round_b110_r1_guardrail.json \
  --groundTruthFile docs/research/2026-08-18-round10-results/haiku_new_videos.json \
  --videos fr,zh \
  --videoIdKey fr=gCU0n6H_MXo,zh=ctR1jrI42uc \
  --out docs/research/parity-test-harness/proof-run-output.json
```

Never print `OPENROUTER_API_KEY`'s value — source it into the subshell
environment as above, don't echo it.

## Proof run (2026-08-18, real, already done)

Ran the batch command above against the real `[1,10]` guardrail round
(`round_b110_r1_guardrail.json`) for the two videos with a clean, fresh,
on-disk Haiku-4.5 ground truth (`fr` = `gCU0n6H_MXo`, `zh` = `ctR1jrI42uc`,
both from `haiku_new_videos.json`). Real result, saved in
`proof-run-output.json`:

| Video | structural_completeness | factual_coverage | missing |
|---|---|---|---|
| fr (`gCU0n6H_MXo`) | 83 | 62 | D10: 10.2 Domain-Specific Risk Disclosures |
| zh (`ctR1jrI42uc`) | 100 | 78 | (none) |

This confirms the harness produces real, sane, differentiated scores from
real saved data (not a stub, not fabricated) and is genuinely re-runnable.

## Known limitation, honestly stated

The proof run above only covers 2 of the 8 videos in the cohort and only the
`[1,10]` bundle, because those are the only two videos with a clean,
independently-saved Haiku-4.5 ground truth on disk in the same JSON shape as
the round-10 candidate outputs (the other 6 videos' Haiku baselines live in
the older, larger `docs/research/2026-08-18-parity-batch-results.json` under
a different schema and were not wired into this harness's batch-CLI mode).
Extending `judge.ts`'s batch mode to read that file's schema too is real,
useful follow-up work — not done here, not hidden.

## The permanent test video transcripts

`docs/research/2026-08-18-parity-test-transcripts/*.txt` — 8 real transcript
files, confirmed present on disk (not something to redo): `9T8L73AidFY.txt`,
`FfdOoDB_fbE.txt`, `LTNVA2iP9YU.txt`, `ctR1jrI42uc.txt`, `gCU0n6H_MXo.txt`,
`sw22FMB_SWI.txt`, `vEC6e5dBi4Y.txt`, `wcgvQs_9Yx8.txt`. These are the
canonical inputs for any future round of this cohort — reuse them, don't
refetch (two of the eight, `ja`/`9T8L73AidFY` and the historical `zh`
candidate, are flagged elsewhere as genuine source-side transcript-quality
ceilings, not fetch bugs — see §9 of
`docs/research/2026-08-18-full-dimension-parity-batch-test.md`).
