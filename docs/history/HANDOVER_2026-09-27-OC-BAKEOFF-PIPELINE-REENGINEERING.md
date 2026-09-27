# HANDOVER — OC Session 2026-09-26/27 → next session

**Read this first.** Repo: `~/projects/hex-yt-intel`, branch `main`. Everything below verified against real files/DB/API probes unless marked otherwise.

---

## 1. MISSION (active workstream)

Model bake-off + pipeline reengineering for vIntel's analysis engine. Goal: replace/augment the 5×-Haiku-4.5 bundle cascade with a cheaper challenger pipeline, judged by **Jev** (`~typesafe/jev-latest` via OpenRouter Decisions API → resolves `typesafe/jev-1.13-20260917`). User targets: **95 parity / 95 style** → Haiku fully dropped; interim bar 90/85 non-inferiority; cost target <9¢/analysis (currently ~$0.145 for a short), stretch <5¢.

## 2. CONFIRMED DECISIONS (ADRs in `.memory/ADRS.md`)

- **[CONFIRMED] 5-Layer Jev-Gated Pipeline Architecture** (2026-09-27) with **10 binding requirements (R1–R10)** folded into the ADR text. Layers: 0 Jev Classification Gate (S1–S6 + multi-speaker + extrapolation-risk, per analysis) → 1 Evidence Extraction (GLM-5.3-flash, chunked map-reduce, typed evidenceLedger, no prose) → Jev Gate A (Dim7 present/partial/absent applicability) → 2 Dimension Bundles (narrow prompts: TOC+guardrails+only requested dims) → Jev Gate B (targeted reruns) → 3 Canonical Synthesis (deterministic, provenance map, no prose) → Jev Gate C + code validators (PASS/REPAIR/ESCALATE) → 4 Locked Style Rendering (evidence-preserving transformation ONLY; never sees transcript or full UCIS prompt) → conditional Haiku polish. Escalation triggers defined (R10). Evaluation: median+P25/P75+worst-case, stratified by class/language/duration/genre (R8). Build phased behind Settings Registry `analysis.pipeline.mode`; **Haiku cascade stays default until new path beats it on the full 14-video pool**.
- **[RETROACTIVE] UCIS v5.4 prompt-update ADR + drift inventory** (Phase A prerequisite). Change was made 2026-09-25 (commit `c4125116`, PR #346) with no ADR. Verified drift: (D1) constant/file `UCIS_V5_3_SYSTEM`/`ucis-v5.3.ts` serve a v5.4 prompt; (D2) line 681 body says "complete v5.3 framework"; (D3) stale "New in v5.1" annotations (lines 434, 547); (D4) **residual active persona steering** at lines 427 ("Persona-Optimised (primary persona served)") and 545 ("Activate 3–5 lenses based on primary persona") contradicting v5.4's indicator-only rule; (D5) duration formatting inconsistency. Fix = naming/wording only, no semantic re-engineering.

## 3. BAKE-OFF RESULTS ( Rounds 1–4, all with real Jev judging)

Harness bugs found & fixed along the way (all quantified): judge anchoring on example numbers (faked figures); 2000-token truncation → GLM hard 0s; **24k extraction slice** cut 40m transcripts in half (−20+ parity); **12k Jev grading slice** suppressed ~19 parity points → **full-transcript grading** (Jev 1M ctx, $0.0006/grade) is the validated protocol.

- **Round 1** (video Z6l4HpuyyP0, 10m finance): extraction winner GLM (90.7 parity). Articulation matrix: GLM→OSS best (passes 3).
- **Round 2** (ymgH8jS6Wb8, 16m): top-3 within ~1.2 pts (Luna Pro 83.4, OSS 82.4, GLM 82.0); articulation 0 passes — video-dependent.
- **Round 3** (MoBr0nQtOnA, 40m): with chunked extraction + full-ctx grading → **GLM chunked extraction parity 91.5 avg (90–93 all 11 dims), style 84.8**. Articulation full-ctx: GLM-identity 91.5/84.6 (5/11 passes), Luna-Pro 91.6/83.6 (5), Luna 90.9/84.1 (4), OSS 88.8/81.4 (2), Llama 65.9/46.5 (0 — collapses on 96k input).
- **Round 4** (1U8-4N1HNtU, Arabic 23m, chunked + full-ctx): **GLM medP=90/medS=83 (4/11 passes)**, Luna 88/76, Luna-Pro 86/75, OSS 83/80, Llama 60/55. Cross-video GLM parity 90.7→91.5→89.4 — **holds cross-lingually**; style 81–84.6 (the gap).
- **Pool**: frozen 14-video benchmark set (R7), transcripts cached in `/tmp/opencode/transcripts/*.txt` (fetched via worker `/fetch-transcript` — needs `Origin: https://hex-yt-intel.vercel.app` header; urllib gets 403, curl works). 5 videos lack completed baselines (yB92mx97A8s, _LCeJZFIsd4, DlNWYzaL_F0, uZ5kJ9CBbv0, 39hqY3nH5ug) — need production-pipeline runs to create them.
- **Jev classification POC validated** (`/tmp/opencode/pool_classification.json`): choice-type needs keyed criteria record; noul needs `{true,false}` object; score needs array criteria (max 10 levels, 0–9 scale, ×(9→100) normalization).
- Cost method: OpenRouter **activity API lags a day**; use `usage: {include: true}` on chat calls (not yet wired) for per-request cost.

## 4. WHERE I STOPPED (exact resume point)

**Just rewrote `scripts/bakeoff-l2-evaluator.ts` (v2, uncommitted)** — the permanent Phase A harness: chunked map-reduce extraction, full-ctx Jev grading, draft persistence to `/tmp/opencode/bakeoff_<video>_drafts.json`, median/P25/P75 HTML+JSON reports, promptVersion pinning (`UCIS v5.4 (c4125116) — unmodified`), frozen 14-video pool, provider pins, incremental reports. **NOT yet done: type-check it, then validate with `BAKEOFF_VIDEOS=Z6l4HpuyyP0` 1-video stripe.**

Next steps in order:
1. Type-check + validate bakeoff v2 script (`pnpm --filter youtube-intelligence-worker exec tsc --noEmit --ignoreConfig --strict --skipLibCheck --target es2022 --module esnext --moduleResolution bundler --types node scripts/bakeoff-l2-evaluator.ts`), then 1-video stripe.
2. UCIS drift fixes (D1–D5) + `ucis-v5.3.ts` rename with compat alias + its test file.
3. Phase B: Layer 0 (Jev classification, versioned routing contract R1) + Layer 1 (evidence ledger w/ provenance R3) behind `analysis.pipeline.mode`.
4. Create baselines for the 5 pool videos missing analyses (needs user/production path).

## 5. UNCOMMITTED WORKING TREE (same-checkout discipline!)

- `scripts/bakeoff-l2-evaluator.ts` (my v2 rewrite, unverified) + `supabase/migrations/20260926163000_history_overview_function_v15_failure_reason.sql` (complete, tested, awaiting commit → CI applies via ADR 013) + `web/lib/utils/history-overview.ts`, `web/lib/ports/AnalysisPersistencePort.ts`, `web/components/templates/console/AnalysisHistory.tsx`, `web/lib/__tests__/history-overview.test.ts` (failure-reason-on-history-cards fix, user-requested, tests pass).
- **AGY1's SSOT auditor files — NOT mine, do not commit as mine**: `web/lib/types/dimension.ts`, `web/lib/types/synthesis-nucleus.ts`, `web/lib/validators/synthesis.ts`, `worker/src/services/ZodSchemas.ts` (+ their `web/lib/types.ts` status-field 2-liner was already committed by me in `ac6e2f32`). Ledger NOTE posted for them.
- Several `docs/history/BAKEOFF_L2_TRENDS_*` outputs (pre-14:13 ones VOID per user — judge was gpt-4o via jev-router).

## 6. COMMITS I MADE THIS SESSION

- `ac6e2f32` fix(ci): AnalysisResult.status field + dedupe-fetch clone guard (unblocked 9 red CI runs since 12:22; root causes: #352 used item.status without the field — field was in SSOT auditor's uncommitted types.ts; #354's unconditional `res.clone()` broke mock-based tests).
- `2cdad796` + `55626d30` chore(oc): OC provider standard → **Morph → CoreWeave → Together → Relace, `allow_fallbacks: false`** (sticky-provider, user clarification; both `~/.config/opencode/opencode.json` and `.opencode/opencode.json` updated, verified identical). Morph serving glm-5.3-flash verified live. CCT/AGY unaffected (CCT=Anthropic models via CCT-sub script; AGY=Gemini native).
- CI is GREEN again after these; production deploy unblocked (had been stuck 11h on `d0c3f88`).

## 7. OTHER COMPLETED USER REQUESTS (ready, uncommitted or landed)

- **Failed-history fix**: user's failed Android attempt (EOiypb2wXM0, billing_status='failed', validation_report.reason="All analysis streams failed.") IS in DB and RPC output — UI just never showed the reason. Fix: v15 migration + type/mapper/card render ("Failed — <reason>" chip). Ready to commit.
- **User-reported UI bugs NOT yet fixed (log as backlog)**: (1) highlights-reel loader inconsistent (circular hourglass vs twirling border) — should use same effect; (2) Simple/Pro summary↔transcript switch not implemented; (3) red pin starts before segment start; (4) first 50s has no keypoints; (5) history page state-awareness (restore page/filters/search on return); (6) history cards: add duration + channel name + dates in standard placement below title; (7) "no highlights reel" message should say "reanalyze to get highlights".
- **Skool.com/classroom videos**: answered — currently YouTube-only; yt-dlp (Wistia-backed platforms supported) → ingest-to-transcripts path is the off-the-hip option; needs its own decision if pursued.

## 8. LAST 5 USER MESSAGES (verbatim)

**(1)** "Claude models through Anthropic's API and AGY runs Gemini/Claude natively (per the routing rules in — Yes, we have another script called CCT-sub, which means CCT subscription. We have the actual subscription with that and another topic models. We have another script, CCT-something-else, which is for the external models. But AGY, I don't know if AGY can support that or not, so fine if AGY cannot support Estonian models that. Okay, proceed with the remaining tasks. But as far as the sequence for morph and core weave and together and base, I think it was the reason we kept allow fallback to false was so that the first model would not fall back to the 2 unless it was actually down. That was the reason because we didn't want provider hopping. We wanted 1 session so as not to lose the cash with the first provider and only if the first provider is rate limited or times out, then we go to the next one and we stay with it until it is also with the rate limited or times out and then we move on to the next one. That's why the fallback was set to false and I think it's a valid solution. So if it is a valid solution then keep it as it was. I mean as far as fallback is concerned."

**(2)** "ingest, review, and tell me what you will do. i propose we go with round 4, get results, then move on to prompt/pipeline reengineering. i also, think step 1 then, should be classification and we should see if Jev would be a good fit for that. i think classifying the videos can help us ensure consistent results as we adjust the pipeline to fit the video type." *(plus pasted Perplexity research recommending: median+quartile reporting, S1–S6 structural classes, 4-layer evidence-first pipeline with Jev gates, GLM primary + OSS style renderer + Gemini Flash/Mistral/GPT-5.4-Mini challengers, evidence-ledger provenance, never polish an unvalidated report)*

**(3)** "Prompt/pipeline reengineering design doc (ADR) — 4-layer architecture (evidence extraction — No, it should be considered as 5-layer starting with the classification based on JEV (you already did above as POC) as a gate because it decides how the pipeline will handle itself. it will be needed with each analysis. so its part of hte pipeline"

**(4)** "I confirm the ADR, including **Layer 0 Jev classification as the routing gate** and the five-layer architecture; include the UCIS v5.4/5.1.1 version-drift fix and yesterday's unlogged prompt-update ADR in Phase A, because both affect baseline reproducibility and must be resolved before the bake-off becomes permanent. Yes—the ADR fits the model I recommended, with one important clarification: it makes Jev classification and evidence locking explicit, rather than relying on the models to infer the pipeline stages themselves." *(plus 10 detailed requirements R1–R10 — full text is folded verbatim into the confirmed ADR in .memory/ADRS.md; key one: Layer 4 must be an evidence-preserving transformation, not another analysis pass)*

**(5)** "stop when you can and Create a THOS report for LLM handover because I need to clear the session; the context is too much and it's affecting my cost. Whenever you can pull what you're doing, we can continue it after I start the session. That will be that: create a comprehensive THOS so you can start exactly where you stopped. Include the last 5 terms verbatim as they are so you don't lose context at all."

## 9. KEY FILE MAP

| Path | What |
|---|---|
| `scripts/bakeoff-l2-evaluator.ts` | v2 harness (just rewritten, needs type-check+validation) |
| `/tmp/opencode/round3-chunked.mts`, `round1.mts`, `articulation-exercise.mts`, `bakeoff-diag.mts` | experiment scripts (validated logic source) |
| `/tmp/opencode/round{1,3}_*.json`, `*_drafts.json` | all round results + drafts |
| `/tmp/opencode/transcripts/*.txt` | 14-video transcript cache (15 including DlNWYzaL_F0, 39hqY3nH5ug) |
| `/tmp/opencode/pool_classification.json` | Jev classification POC output |
| `.memory/ADRS.md` | confirmed 5-layer ADR + UCIS v5.4 retro ADR |
| `docs/history/BAKEOFF_L2_TRENDS_LATEST.html` | latest report (read the HTML, not MD) |
| `web/lib/prompts/ucis-v5.3.ts` | UCIS prompt w/ drift D1–D4 at lines 1, 427, 434, 545, 547, 681 |

## 10. STANDING RULES RECAP (don't re-learn these)

Jev judge via Decisions API only (never chat-completions, never jev-router); provider pins sticky (`allow_fallbacks: false`); staged stripes with BAKEOFF_VIDEOS; incremental HTML reports; verify-before-trust (live probes for model ids/shapes); transcript-grounded parity; median+quartile reporting; never print secret values; ledger protocol (`[IN_PROGRESS]`/`[DONE]`, cross-agent NOTES via `.memory/AGENT_LEDGER.md`); commits only when asked; promptVersion pinned per run (R9).
