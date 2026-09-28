# THOS — OC Session 2026-09-27 → 2026-09-28 (LLM handover)

**Read this first.** Repo: `~/projects/hex-yt-intel`. Branch at handover: `fix/wave-4-remediation` (clean, synced, CI green). Written 2026-09-28T07:29Z. **Update this file at the end of EVERY wave.**

---

## 1. MISSION CONTEXT (active workstreams)

- **Model bake-off + pipeline reengineering** for vIntel (5-layer Jev-gated pipeline, ADRs confirmed). Baselines pool: **2/5 frozen** (DlNWYzaL_F0, 39hqY3nH5ug 3h — both verified from DB). Remaining: yB92mx97A8s, _LCeJZFIsd4, uZ5kJ9CBbv0 — user reruns via UI, OC verifies + freezes.
- **Wave 4 remediation** (Sentry-driven): Tasks 1–4 ALL committed on `fix/wave-4-remediation`, CI green (latest run success).
- **Stability incident class**: long-video zero-persist + highlights/digest failures — root causes found & fixed this session (§3).

## 2. CONFIRMED DECISIONS / STANDARDS (this session)

- **OC model standard v2**: custom provider `glm-preset` (`@ai-sdk/openai-compatible`, baseURL openrouter) → preset `@preset/glm-53-flash-on-cheap` passes the preset id VERBATIM (client routing blocks were silently dropped; built-in openrouter rewrites @preset ids). Credential copied file-level into `auth.json` under `glm-preset`. 3 config files identical: `~/.opencode/opencode.json` (loaded LAST, overrides), `~/.config/opencode/opencode.json`, committed `.opencode/opencode.json`.
- **Standing lesson (user directive)**: contracts must be defined, executed, enforced **END-TO-END** — producer AND consumer sides updated together; never declare failures "pre-existing and forgotten" — they go on `docs/history/ROSTER_TECH_DEBT_2026-09-27.md` until closed.
- **No hardcoded tunables**: transcript budget moved to Settings Registry (`analysis.transcriptBudgetChars`, default 48000, migration 20260927120000).
- **KG cap — user directive 2026-09-28: 24 nodes / 18 edges is CORRECT** (ROE spec). Pending implementation this wave: web/lib/validators/synthesis.ts + worker ZodSchemas currently at 24/24; edges must go back to 18. NOTE the tension: my 2026-09-25 data (p90=20 edges, 31/88 rows rejected at 18) is superseded by the user's standard — record the baseline impact in the bake-off notes.
- **Provider automation**: ADR 033 draft at `docs/adr/ADR-033-PROVIDER-AUTOMATION-DRAFT.html` — v2 with user feedback (p95 latency, throughput, 3-component price w/ cache-read weighted heaviest, two-step privacy-allowlist activation for new providers, AUTO mode first). **Awaiting explicit confirmation before build.**
- **Re-analyze selective scoping** (only regenerate missing pieces) = **ADR 021 Phases 2–4** — user asked for it, not yet built, awaiting "confirm ADR 021 Phase 2-4 build".

## 3. WHAT WAS DONE (chronological, all verified)

### Infra/platform repair
1. **Vercel deploy chain fixed**: since PR #342 (git auto-deploy off), CI's `vercel deploy --prod` ran from repo ROOT → uploaded a no-app static listing ("Files within /") with Framework=Other production override from a stray drpd53fka artifact. Root-dir deploy is CORRECT (project rootDirectory=web; CLI from web/ double-roots → "web/web does not exist", reverted). User re-pinned Framework=Next.js in dashboard. Verified live: app serving, dashboard 307.
2. **Migration drift (ADR 018 class, recurring)**: `20260925120000_prompt_caching_settings_and_cached_tokens.sql` NEVER applied (duplicate timestamp collision with v14) → every persist since Sept 25 died on missing `analysis_chunks.cached_tokens`. Fixed: applied live via Management API (DDL + 2 settings defs + 2 values), renamed to `20260925120001` (CI db push reconciles; DDL idempotent); v15 failure-reason migration applied + registered `20260926163000`.
3. **Failed-row cache-hit trap**: `findCachedAnalysis` excluded only `processing` → FAILED rows returned as cache hits → misleading "Streaming endpoint not configured (NEXT_PUBLIC_WORKER_URL)" errors. Fixed: excludes failed rows; client distinguishes `ERR_RESTORE_UNUSABLE` ("Use Re-analyze") from `ERR_STREAM_UNCONFIGURED`.

### Persist pipeline (end-to-end contract enforcement)
4. **comments shape contract** (RCA via the NEW 400-body logging): worker sent object-shaped comments through an unchecked `JSON.parse(cached) as VideoComment[]` on a **7-day** comments cache → every persist 400'd → zero chunks. Fix: `normalizeVideoComments()` producer-side choke point (unwraps `{comments:[...]}`, validates element shape, degrades to null) at both cache readers + the assignment. Verified by DlNWYzaL_F0 rerun: 11/11 dims, 5/5 chunks, billing completed.
5. **Persist 400 observability**: PersistService now logs the 400 response body (500 chars) — the response carries the route's exact Zod fieldErrors; this logging named the comments field on first occurrence and is the standing RCA tool.
6. **costUsd min(0) removed** — OpenRouter usage costs can be legitimately negative (credit discounts); a negative was rejecting whole signed persists.
7. **Truncation guardrails** (user directive — no success-washing): hardcoded 48000-char slice in getUCISPrompt (2 sites) → registry key, threaded bouncer→signed request→worker→EngineContext→PromptBuilder→getUCISPrompt; prompt's in-band notice states real coverage %; worker emits `transcript-truncated` status frame; client schema + StreamStatusTracker updated (I initially violated the end-to-end contract — caught in user's console — fixed same wave, surfaced as logError in the stream log).

### Client fixes
8. **KG fragment tolerant validation**: one node with unknown entityType rejected the WHOLE kg fragment (15 nodes/20 edges erased). Never-reject-always-degrade: unknown entityType→'concept', unknown kind→'related', clamps weight/polarity/strength/dimension, slice to caps, drop unusable entries; union-level preprocess keeps discrimination. 6 regression tests.
9. **Highlights stuck "Generating highlights" forever** (rows existed in DB): (a) `dedupedFetch` could hand a new caller a dead (already-rejected) in-flight entry → new cycle died with inherited AbortError; entries now carry `settled` flag, dead entries bypassed; (b) dead cycle rendered the loading-lookalike forever (`if (loading || !data)`) → split into `if (loading)` + `(!data || empty)`; empty-state copy per backlog: "Use Re-analyze to generate this video's keypoint reel."; (c) loader visual: revolving conic border (GlowBorder/hx-spin) matching accordion chips, not a Spinner glyph.
10. **Digest-swarm RCA**: ReconcileHighlightsUseCase fired a real groq OSS-120B completion on EVERY cached-digest view → N polls = N paid calls. Pre-guard: reconcile only when a highlight row has null/out-of-range takeawayIdx.
11. **Thumbnail quality ladder**: pre-interaction player facade used hqdefault (480×360, blurry upscale). New `YouTubeThumbnail` maxres→sd→hq with per-img onError; user-confirmed working (maxres→sd fallback visible in network log).
12. **Out-of-credits owner alert**: 402/`ERR_MONTHLY_QUOTA_EXHAUSTED` → Sentry ERROR capture (aggregates into one high-priority issue → owner email) + loud console.error; end-user error stays generic per user boundary. OpenRouter hit zero credits mid-session (user topped up).

### Deps & CI
13. **14 Dependabot alerts closed** via advisory-confirmed override floors in pnpm-workspace.yaml: sharp ^0.35.4 (GHSA-rgj7-g3m4-5g8c), smol-toml ^1.9.0, js-yaml ^4.3.2 (4.x-legacy line, 5.x major NOT taken), qs ^6.16.0, fast-uri ^3.1.8, hono ^4.13.9 (worker + video-pipeline standalone install). vitest 5.0.2 major REVERTED to ^4.1.11 (broke fake-timer assertions; negative-control verified). browserslist/baseline-browser-mapping already latest.
14. **My own CI reds fixed**: dedupe-fetch `entry` typing + unescaped apostrophe — lesson: run FULL tsc+lint before pushing, the targeted-file check missed cross-file type errors.

### Wave 4 (AGY-orchestrated, OC-verified)
15. Task 1 `safe-storage.ts` (Android WebView SecurityError probe) — committed; Task 2 highlights 45s decaying poll (8 attempts [0,3k,6k,10k,15k,25k,35k,45k], `HIGHLIGHTS_POLL_INTERVALS` single source of truth for both consumers) + manual Check-Status button — committed `d472d08c`, **independently verified by OC** (tsc 0, lint 0, vitest 209 files/2167 tests); Task 3 INP 248ms (`42de1472`, startTransition + ref-stable callbacks); Task 4 reaper partial-status preservation (`fb1a77df`). Wave 1–3 data contracts merged via **PR #356**.

### Baseline benchmark pool
16. **DlNWYzaL_F0**: COMPLETE — 11/11 dims, markdown 46,194 chars, KG 15/15, classification, 40 highlight rows, digest in, prompt caching verified (22,405 cached tokens read per bundle 2–5).
17. **39hqY3nH5ug (3-HOUR)**: COMPLETE — 11/11 dims, markdown 32,688, KG 15/19, 26 highlight rows, at **27% transcript coverage (48K/177.5K)** — coverage is now a frozen benchmark variable for Phase B.

## 4. CURRENT WORK (in flight at handover)

- **KG cap → 24/18** (user directive this turn): implement edges 18 in both schema files + update slice logic. NOT YET DONE.
- **History card polish** (AGY's history thumbnails, user feedback): shrink slightly + thin empty space around the image; zoom out (more landscape) so thumbnails aren't chopped at left/right edges; **add duration with a clock icon**; **highlights chip missing from history list** — restore it. NOT YET DONE.
- **Highlights "once and for all"**: EOiypb2wXM0 (user's own Android test video) still shows "No highlights yet / Use Re-analyze" — highlights generation never lands for it; user reports a "reconciliation cascade" running for hours without updating. Needs deep RCA (candidates: digest never generated → scheduleHighlightsRecovery never fires; or recovery fires but extract produces 0; or the takeawayIdx pre-guard I added today skips re-linking rows that exist but are unlinked). NOT YET RCA'd.
- **INP still ~208–320ms** on URL paste + accordion clicks (user: "you broke something"). Task 3's startTransition work deployed but insufficient. Needs profiling on the real components.
- **YouTube iframe postMessage origin warnings** (`www-widgetapi.js`): noise from the YT SDK origin mismatch — log-only, low priority.

## 5. KEY FILE MAP

| Path | What |
|---|---|
| `web/lib/utils/highlights-settings.ts` | 8-attempt poll schedule, single source of truth |
| `web/components/dashboard/HighlightsScrubber.tsx` | scrubber + manual refresh + render states |
| `web/lib/utils/dedupe-fetch.ts` | shared in-flight dedupe (settled flag) |
| `web/lib/validators/synthesis.ts` | fragment/payload schemas (KG tolerant normalization; status frame w/ transcript-truncated) |
| `web/lib/adapters/stream-status-tracker.ts` | status frames → stream log |
| `worker/src/services/PersistService.ts` | S2S persist + 400-body logging |
| `worker/src/routes/analysis.ts` | normalizeVideoComments, truncation status, persist flow |
| `web/lib/prompts/factory.ts` | getUCISPrompt + registry-driven budget + in-band truncation notice |
| `worker/src/services/LLMCascade.ts` | cascade + 402 owner escalation |
| `pnpm-workspace.yaml` | security overrides (advisory-confirmed floors) |
| `docs/research/2026-09-27-long-video-repro-corpus.json` | 3 reaped failed rows (incident corpus) |
| `docs/history/ROSTER_TECH_DEBT_2026-09-27.md` | standing debt roster (D1 worker-tsc 99 lines, D2 lint warnings) |
| `docs/adr/ADR-033-PROVIDER-AUTOMATION-DRAFT.html` | provider automation draft (awaiting confirmation) |
| `/tmp/opencode/transcripts/*.txt` | 14-video transcript cache |
| `.opencode/opencode.json` + `~/.opencode/opencode.json` + `~/.config/opencode/opencode.json` | OC standard (3 identical files) |

## 6. STANDING RULES (don't re-learn)

Verify-before-trust (live probes, not self-reports); contracts enforced end-to-end (producer+consumer together — violated twice this session, caught both times in user console/logs); no hardcoded tunables (Settings Registry); debt → roster, never "pre-existing and forgotten"; commits only when asked; negative-control verification for bug fixes; ledger protocol (`[IN_PROGRESS]`/`[DONE]`, cross-agent NOTES); never print secrets; provider standard: `glm-preset/@preset/glm-53-flash-on-cheap` verbatim, no `-m` overrides; user prefers: tables for 3+ items, evidence-based pushback, THOS updated per wave.

## 7. LAST 4 USER MESSAGES (verbatim)

**M1** (baselines + credits): "I retried, of course the system is back online, which is good. I retried the video that I was required to review for you. Remember the 5 videos I have to do for you. This is 1 of them. So give me the list of all the videos that you need. I think there are 3. And everything worked except the digest, the dimension 0, and the highlights. … check. you should check on your own. without me. … [Dependabot alerts list] … I will feedback with result from prod. deploy"

**M2** (credits + provider automation): "It didn't work, it went 1 or 2 to morph and then together took the leading hand for some odd reason. I'm okay with together in an odd sort of way, but I definitely prefer more as a provider. … we need to find a way to automate this. … Why P50 latency? Why not T95 latency? Also you cannot exclude the throughput; the higher throughput is better and price is important, but there are 3 components of price. There is the input price, the output price, and the cash price. Sometimes the cash price is more important than both prices … if a provider is doing better … even if it's not in the allowed list, it should be recommended but highlighted that it is not in the allowed list because it has to be added in the privacy settings as a provider. Otherwise, simply changing the order of adding it will make it unavailable. … the reason I chose more was because it was consistently getting better and the cash read price is 0.03247 … the latency was one of the least it was around three seconds compared to relays of eight seconds and together of 5.7 seconds … Now let me ask you why are you involving me as a man-in-the-middle to fix the deployment on Bursa? You have the CLI tools and you have access to everything. Why don't you do it yourself? … I updated the key and you could have updated it yourself. … Why are you breaking my balls?"

**M3** (3h video + lessons): "So if the word got truncated at 48k, how does it pass as a successful analysis? The log clearly states that it was a successful analysis. … We are redoing the prompt. We're in the middle of a very serious prompt re-engineering exercise. So I wouldn't be worried about this particular scenario right now. For the current prompt, I want the guardrails and control mechanisms in place in general, and the contract definition, execution, enforcement, and the end-to-end process in proper and pristine shape, not broken up and lacking the mechanisms. So I'm saying this for any work we're doing right now and in the future as a learned lesson that you should commit to memory. … [image] the moment I press analyze, it's replaced with a very low-quality image instead of it … after the updates. crash! … I told you yesterday that this was a conductive enforcement issue. I told you the definition of the contract and the enforcement of the contract when you made some changes you didn't make it end-to-end so the contract was not updated end-to-end and that's why. … check if it landed and what is missing … check the logs as well … there is a swarm of oss120b on groq over hte pat 7 minutes."

**M4** (current turn, 2026-09-28): "Now to start, and before anything, I want you to give me a THOS report for LLM-handover which should include everything done since yesterday, so all of yesterday is work till now, and it should include the last few responses verbatim so that the transition or a resumption of the tasking can go smoothly. give The mean, the path of the THOS, and with every wave, once you finish update the THOS. 24 nodes / 18 edges this is the correct one. I saw the update and the history list where you inserted the image, which is good, but I think you should leave a thin empty space around it, so you should shrink it a bit … zoom out a little bit so that you can capture a little bit more of the thumbnail because right now most of the thumbnails are actually sort of chopped off at the left and right edges … I also told you before that I mentioned that you have to set the duration. So you put a clock or something and you insert the duration. … the chip for the highlights is gone for some reason it's not there, and all of this is in the analysis history menu item or page … when I go inside the videos … the highlights are still not working. So we need to do something about that once and for all. https://www.youtube.com/watch?v=EOiypb2wXM0 'No highlights yet — Use Re-analyze to generate this video's keypoint reel.' … inp issues still there. you broke something and it needs fixing"

## 8. HANDOVER CHECKLIST (next session)

1. Implement KG edges 24→18 (both files) + note the baseline-impact tension.
2. History card: thumbnail polish (shrink + margin + landscape zoom) + duration w/ clock icon + restore highlights chip.
3. Highlights "once and for all" RCA (EOiypb2wXM0).
4. INP profiling.
5. Baselines 3/5: yB92mx97A8s → _LCeJZFIsd4 → uZ5kJ9CBbv0 (user runs, OC verifies + freezes).
6. Await: ADR 033 confirmation, ADR 021 Phase 2-4 confirmation.

---

## 11. HANDOVER UPDATE #2 — 2026-09-28T09:24Z (session clear, cost)

Everything below happened AFTER the original THOS body above and IS INCLUDED in this update. Branch at handover: `fix/wave-4-remediation`, HEAD `06feacd9`, **pushed to origin** (verified: origin/fix/wave-4-remediation = 06feacd9). Working tree CLEAN. Full vitest 209 files / 2167 tests, 0 failed. tsc 0. eslint 0 issues.

### 11.1 Wave: history-overview v16 + highlights "once and for all" + memory leak (commit 06feacd9)

1. **Highlights "once and for all" — ROOT CAUSE CONFIRMED as client-side, NOT generation**: the user's fresh EOiypb2wXM0 re-analysis (0b4918dd, 11:40 local) has billing=completed, digest present, AND **16 highlight rows in the DB** — generation works end-to-end. The UI failure is the dedupe-fetch **abort-window race**: when consumer A's local abort empties the shared entry's consumer count, the shared controller aborts SYNCHRONOUSLY but the deleting `finally` is ASYNC — a caller joining in that window inherits the dying entry, gets its AbortError, and its whole retry cycle dies at `data=null` → renders "No highlights yet / Use Re-analyze" while rows exist. TWO fixes in `web/lib/utils/dedupe-fetch.ts` + `web/components/dashboard/HighlightsScrubber.tsx`: (a) new callers bypass entries that are `settled || controller.signal.aborted`; (b) the scrubber's fetch loop treats an inherited-AbortError (own controller alive) as a RETRYABLE attempt failure — continues its own backoff loop instead of dying.
2. **Memory leak (~1GB Chrome tab, user screenshot)**: (a) `useAnalysisStore.terminalLines` grew UNBOUNDED (every append copies the whole array = O(n) per call, quadratic garbage across hours of streaming + the reconcile-swarm period) → **capped to newest 400 lines**; (b) client Sentry `tracesSampleRate` 1.0 → **0.1** (all-day OTel span retention). Note: Sentry Session Replay was NOT configured (ruled out).
3. **History cards (user feedback batch)**: v16 migration `20260928100000_history_overview_function_v16_highlights_duration.sql` adds `has_highlights` + `duration_seconds` to the overview RPC (restores the **Highlights chip** that silently disappeared, adds the **duration clock chip** the user requested); **applied live via Management API + registered** (verified: 95 rows, EOiypb2wXM0 has_highlights=true, duration 1169s). Mapper/port/raw-row types extended (`hasHighlights`, `durationSeconds`); history-overview test updated. **Thumbnail polish** (user: shrink + thin empty space + zoom out, less left/right chop): tile padded `p-1.5` with a rounded inner frame, `object-cover` → `object-contain`.
4. **KG edges 24→18** (user: "24 nodes / 18 edges — this is the correct one"): both `web/lib/validators/synthesis.ts` and `worker/src/services/ZodSchemas.ts` set to 18 with the supersession recorded in comments; tests aligned (20-edge real fragment now SLICES to 18 — the never-reject principle stands); §2 above's "pending implementation" is now DONE — the 2026-09-25 telemetry-derived 24 is formally superseded by user standard.
5. **Digest provider lock (user directive)**: exec-digest gpt-oss-120b was landing on BaseTen/DeepInfra. Two leak paths fixed: adapter hardcoded `allow_fallbacks: true` → **false**; fallback list + LIVE registry carried a Baseten entry → removed from both (registry updated live: Groq → Cerebras only, verified via REST). Groq serves automatic prefix caching, so sticky repeats hit cache reads.
6. **Mapper test fix**: `history-overview.test.ts` expected-object updated for the two new fields (the only full-suite failure; caught and fixed same wave).

### 11.2 User's last message this segment (verbatim)

"Please create a THOS report for LLM handover because the context window is blown up and I need to clear the session. It costs me a lot of money. So once you're done with this task you're doing, proceed with creating a THS using the template and let me know where the path is and what are the key highlights. So it's the same THS you're updating. So it's an update to the existing."

### 11.3 RESUME CHECKLIST (next session, in order)

1. **Deploy check**: this commit (06feacd9) is on branch `fix/wave-4-remediation` — merge/PR to main when ready so the highlights fix + history cards + memory-cap reach production; then user verifies EOiypb2wXM0 shows its 16 highlights WITHOUT re-analyze (pure client fix).
2. **Baselines 3/5**: user reruns yB92mx97A8s → _LCeJZFIsd4 → uZ5kJ9CBbv0; OC verifies from DB (11/11 dims, chunks, highlights, digest) + freezes the record; then the frozen 14-video pool is complete and Phase B can start.
3. **INP still open** (~208–256ms on URL paste + Re-analyze click): Task 3's startTransition landed but insufficient — needs real profiling; user: "you broke something and it needs fixing."
4. **`TranscriptAPI key not configured`** (33 Sentry events): worker secret `TRANSCRIPTAPI_API_KEY` never set — `wrangler secret put TRANSCRIPTAPI_API_KEY --env production` (user-side; chain falls back to Apify meanwhile).
5. **Awaiting user confirmation**: ADR 033 build (provider automation, draft at docs/adr/ADR-033-PROVIDER-AUTOMATION-DRAFT.html); ADR 021 Phase 2–4 build (selective re-analyze).
6. **Sentry triage**: `persist: invalid request payload schema` (was 121→230 events, Escalating) — should STOP after this deploy (root causes fixed earlier); `InvalidNodeTypeError selectNode on Range` (HEX-YT-INTEL-5K, 2 events) — un-RCA'd, queue; `Colon expected` (3Z) — known best-effort BracketBuffer class.
7. **THOS maintenance**: update THIS FILE (append a new `## N. HANDOVER UPDATE` section) at the end of every wave per the standing protocol.
