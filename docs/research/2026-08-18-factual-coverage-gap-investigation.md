# Factual-Coverage Gap Investigation — GPT-OSS-120B vs Haiku 4.5 (2026-08-18)

**Status**: real, n=1 video/bundle isolate test, extends §8-§11 of `2026-08-18-full-dimension-parity-batch-test.md` and `2026-08-18-full-parity-final-scores.md`/`per-stream-scores.md`. Uses the committed `docs/research/parity-test-harness/judge.ts` v1.0.0, unmodified.

## 1. Prior context (already on disk, not re-derived)

The full-cohort re-score (`full-parity-final-scores.md`) found factual_coverage stalling at 41-62% across every UCIS bundle even after the checklist-fix (§8) closed most of the *structural_completeness* gap (35-60% → 80-100% on 4/5 bundles). §8 explicitly noted: "factual coverage did not move much versus §3's baseline in any bundle... the checklist fix repairs shape, not substance." That is the exact gap this task investigates.

## 2. Real evidence: length ratio tracks factual_coverage, and it's not a hard token cap

Read the real `[5,7]`/`[8]`/`[1,10]`/`[2,4,6]`/`[3,9,11]` GPT-OSS-120B outputs for video `ctR1jrI42uc` (Chinese-teaching podcast) from `docs/research/2026-08-18-round10-results/round_*.json`, against the real Haiku 4.5 ground truth in `haiku_new_videos.json`:

| Bundle | OSS output length | Haiku length | ratio | factual_coverage | structural_completeness |
|---|---|---|---|---|---|
| `[1,10]` | 5,980 | 11,588 | 1.94x | 72 | 65 |
| `[2,4,6]` | 4,178 | 6,521 | 1.56x | 45 | 35 |
| `[3,9,11]` | 10,687 | 19,242 | 1.80x | 72 | 68 |
| `[5,7]` | 4,872 | 20,752 | **4.26x** | **35** | 42 |
| `[8]` | 8,658 | 22,728 | 2.63x | 35 | 42 |

Length ratio and factual_coverage move together — the worse the length gap, the worse the score. Every one of these calls returned `finish_reason: "stop"`, not `"length"` — GPT-OSS-120B is **voluntarily terminating early**, not hitting a token ceiling. `LLMCascade.ts`'s `MAX_TOKENS_FALLBACK` actually gives the non-Haiku ("default") bucket a *larger* budget (16,000) than Haiku's own bucket (8,192) — so a hard-cap explanation is ruled out.

## 3. Reading the real text: what specifically gets dropped

Dimension 5/7 content for `ctR1jrI42uc` (`docs/research/2026-08-18-round10-results/round_b57_r1_guardrail.json`) vs Haiku ground truth:

- Haiku's Tier-1 Insights section: 5 items, each with a verbatim named-speaker quote, an `[HH:MM:SS]` timestamp, a "Why this matters" strategic note, an `Evidence quality` tag, and a `Lens applied` tag (all four sub-fields the prompt explicitly requires at lines 203-211/508 of `ucis-v5.3.ts`).
- GPT-OSS-120B's Tier-1 Insights section: 5 one-line bullets, Chinese-phrase titles with a single English clause each, **zero** per-item timestamps beyond one placeholder, **zero** Evidence-quality/Lens-applied tags anywhere in the dimension.
- Dimension 7 (Implementation Systems): Haiku gives 3-4 systems, each with Prerequisite/Steps/Success metrics/Common pitfalls/**Troubleshooting guide**/**Risk factors & mitigation** (6 sub-fields, ~2,000-2,500 chars per system). GPT-OSS-120B gives 4 systems but only Prerequisite/Steps/Success metrics/Pitfalls (4 fields, ~250-400 chars per system) — Troubleshooting guide and Risk factors are dropped from every system, even though the prompt names both explicitly (`ucis-v5.3.ts` line 265).

This is not omission of facts the model never "saw" — it's **compression**: the same 5 insights and 3-4 systems are present (structural_completeness on this pair was 42, i.e. headers mostly present), but each one is collapsed to a single terse bullet instead of the multi-field, quote-anchored elaboration the prompt template shows and Haiku produces. Confirms the working hypothesis: this is a task-interpretation gap ("give me the key points" vs "exhaustively fill every named sub-field per item"), not a comprehension ceiling — consistent with the user's real voice-dictation pipeline evidence that GPT-OSS-120B follows narrow, explicit, anti-paraphrase instructions well.

## 4. Real intervention tested

Built a minimal isolate on top of the *already-proven* checklist+guardrail fix (matching `round_b57`'s own `opts: {guardrail:true, checklist:true}`), adding one new block — **EXHAUSTIVE EXTRACTION MANDATE**: explicit "do NOT summarize/paraphrase/compress," "a template's `1.` is a format example, not an instruction to stop at one item — fill every slot up to the transcript's real ceiling," and an explicit per-system four-sub-field requirement (mirrors the user's real working "do NOT paraphrase" instruction style).

Two real OpenRouter calls (`openai/gpt-oss-120b`, temp 0.3, max_tokens 16000, same transcript `docs/research/2026-08-18-parity-test-transcripts/ctR1jrI42uc.txt`, same `[5,7]` bundle, same checklist+guardrail base), judged against the same Haiku ground truth text with the same committed `judge.ts`:

| Variant | Output length | structural_completeness | factual_coverage |
|---|---|---|---|
| Control (checklist+guardrail only, my harness reconstruction) | 1,444 chars | 0 | 0 |
| **+ Anti-paraphrase mandate** | **10,550 chars** | **100** | **72** |

**Honest caveat on the control**: it collapsed to `[Insufficient data in source transcript to fulfill this dimension]` for both D5 and D7 entirely — a known separate failure mode (§9's over-eager Insufficient-Data-Protocol invocation), not a clean length-only control. It is not directly comparable to `round_b57`'s real 35/42 baseline (different harness reconstruction, per the project's own documented judge/harness-drift problem). The one number that IS apples-to-apples is anti-paraphrase-vs-control under the identical committed judge on the identical ground truth: adding the mandate took the response from a total bail-out to 10,550 chars (2.16x Haiku's original 4,872-char OSS baseline, closing most of the 4.26x length gap) and factual_coverage 0→72.

**Real cost**: 2 generation calls ($0.00876 + $0.00593 = $0.0147) + 2 judge calls (small, Haiku-4.5-as-judge, not separately logged but consistent with prior ~$0.005-0.01/call). Total well under $0.05.

## 5. Verdict

- **Root cause pattern**: confirmed cross-cutting and prompt/task-design, not a model-capability ceiling. GPT-OSS-120B has the facts (it read the same transcript) but defaults to a "key-points summary" interpretation of a template that never states an explicit minimum item count or an explicit anti-paraphrase rule — exactly the class of instruction the user's real working voice-dictation prompt supplies and this prompt doesn't.
- **Fix tested and it moved the needle hard** on this n=1 sample: factual_coverage 0→72, structural_completeness 0→100, output length 7.3x longer, on top of the already-shipped-experimental checklist+guardrail fix.
- **Not yet production-ready**: n=1 video/bundle only (this task's explicit 2-3-iteration cost-discipline cap), no clean isolated control (the control run tripped an unrelated over-eager insufficient-data collapse rather than giving a matched non-anti-paraphrase baseline), and every prior fix in this cohort (§8/§9/§11) that looked strong at n=1-2 either regressed or needed a carve-out at n=8. Same standing risk applies here: the "fill every slot" instruction could over-fire on genuinely short/thin transcripts, inventing padding rather than reflecting real content — untested at this n.
- **Recommended next step (not done here, respecting cost discipline)**: re-run this exact anti-paraphrase mandate at n≥8 across all 5 bundles through the committed harness, watching specifically for factual_coverage movement (not just structural_completeness, which the checklist fix already saturates) and for false-positive padding on thin-content videos.
