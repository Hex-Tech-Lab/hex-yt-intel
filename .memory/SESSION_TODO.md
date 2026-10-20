# Session TODO — see docs/history/THOS_2026-10-03_CRUCIBLE_P2.6_TIMESYNC_HANDOVER.md §1–§2 (authoritative)

## Open (2026-10-03)
- [ ] #417 Phase 2.6 time-sync — ready, core CI green (e23cb4f7); one more medium /code-review, then merge + confirm migration 20261003120000 on main + admin run
- [ ] Phase 2.6 step 2: deterministic KG merge + persona/classification from projective cell (dispatch AGY Flash)
- [ ] Phase 2.6 step 3: QStash per-dimension LLM merge (gpt-oss tier) + browser 3-min wait (dispatch AGY Pro)
- [ ] Re-run Carmack (admin) and compare to the 2026-10-02 crucible
- [ ] 2.6-ux-polish (AGY Flash): ETA EWMA, ticker Framer Motion, real swoosh + volume tied to player, DimensionAccordion edge spin, INP on Analyze
- [ ] kg/classification SSE fragments rejected in browser (untraced)
- [ ] Rows overwritten by the old validation webhook are not repaired (decide: leave or backfill)
- [ ] Worktrees kept for user decision (THOS §1.7); hex-yt-intel-hotfix stray folder
- [x] Jev ON for admin only (enabled=true, maxChunks=16, cap 5000); TranscriptAPI secret fixed + /health/providers gate
- [x] Merged: #410 #412 #413 #414 #415 #416

# Session TODO — see docs/history/THOS_2026-10-02_R3B_2.3.5_2.5_MAPREDUCE.md §1.6–§2 (authoritative)

## Open (2026-10-01 session 2)
- [x] #395 middleware S2S exemptions merged (98090ab3) · #396 (0762ff14) · #397 migration (841d305a)
- [x] Backfill DONE: 41/41 completed, 3820 classified, $0.119 (#395 middleware, #396 author column, #397 comment_type constraint)
- [ ] comment_classifications.cost_usd written as 0 per row (cost only in insights total)
- [x] #398 OC X-Title merged (4f6b18be) · [ ] hex-expan to ACK + launch with -m glm-cheap-preset/...
- [ ] 2.3C follow-up: clear activePlanRef/plan/planSource at analysis start + stopAnalysis; split SSE schema (require v/source) vs job schema
- [~] #388 hardening → folded into 2.3.5a
- [ ] #390: real truncation for truncatedFallback (before Jev enabled)
- [x] 2.3.5 architecture approved (mint per wave via /stream-tokens; slice folded into v2; mismatch ⇒ K=1 + Sentry; maxParallelStreams=6)
- [x] 2.3.5a #399 (d029d3ea) · 2.3.5b #400 (f1d17cb4) merged
- [x] 2.3.5c #403 (badbd0e6) · 2.3.5d #404 (417348d6, AGY + CC) · 2.3.5e-prep #405 (70b47bd2, migration live: maxParallelStreams=6)
- [x] Ticker quick win #402 (b484d923) · timestamp-synced reveal PARKED (UI polish phase)
- [x] #401 SSE named-event frames skipped (9876e514)
- [ ] OC OpenRouter key hit monthly limit — user to raise or route OC work to AGY
- [~] Phase 2.5 (CC-owned, design https://claude.ai/artifact/3xNotLwGPFs6qeiKkAayTk). Live view OVERRIDDEN: chunk 0 streams live, word cloud + edge spin animate, detail panel locked (copy disabled, 'Applying Intelligence…' banner, live ETA) until finalize swap. Decisions 2/3 assumed (partial badge; admin-only first run).
  - [x] 2.5a #406 merged (62d1cb17): expectedCells + reducer fixes
  - [x] 2.5b #407 merged (ccecbfbf)
  - [x] 2.5c #408 merged (ad741170)
  - [x] 2.5d #409 merged (dcfa00e4)
  - [x] Billing LOCKED: lost cell but all 11 dims = completed + partial badge
  - [~] 2.5e: part 1 draft #410 (run store, ETA, progressOnly adapter); part 2 = useSSEStream runJevCells + grid/drawer lock + swap (THOS §1.6)
  - [ ] After 2.5e: admin-only Jev gate, then one long video the user picks
  - Decisions 2/3 APPROVED: partial badge; admin-only first K>1 run
- [ ] Old OC 2.5 WIP 0b102617 (worktree hex-yt-intel-r3b-25) is reference only — do not merge
- [ ] deploy-hmac-secret.yml is broken (no Cloudflare step, deploy lacks target) — fix or delete
- [ ] hex-expan commit guard decision; worktree cleanup; privacy; highlights reel sync

## Done 2026-10-01 session 2
- [x] #392 2.3W worker plan event + route tests (c932ca6a) · #394 2.3C client plan consumer, CC envelope-schema fix (43b117ba)
- [x] STREAM_HMAC_SECRET rotated (Vercel prod+preview, CF worker prod, prod redeploy; auth window 09:29:45–09:32:03 UTC)

## Done 2026-09-30 PM → 2026-10-01
- [x] #381 CAS heal + backfill script · #382 history row v3 · #383 Dispatch B UI · #384/#385/#386 zero-downtime chunk key · #387 reducer · #388 token v2 · #389/#390 plan endpoint · #391 reducer hardening

---
# Session TODO — see docs/history/THOS_2026-09-30_1100_COMMENTS_JEV_TIER3_UI_RADIUS_R3B.md §2 (authoritative)

# Session TODO — 2026-09-30

## Done this session
- [x] #369 merged (OC standard + ADR 037 row + THOS; glm-bmt union, Morph label)
- [x] R4 takeover → #370 merged (e10b9a4e); review fixes (isValid, error-path tests)
- [x] #371 merged (ledger follow-ups + prompt archive)
- [x] Main checkout ghost tree burned; local main = origin/main
- [x] ADR 037 Addendum A written (private doc) + CLAUDE.md row Accepted
- [x] stream_count / jev_chunk_index migration drafted + prod dry-run (branch feat/r3b-2-contract, local)
- [x] R3b step 1: OC partial → CC Gate 1 (2 engine bugs, 3 vacuous tests, 1 prod-failing migration) → PR #372

## Open
- [ ] #372 review + merge; apply 20260930120000 migration (ADR 018 rename)
- [ ] Step 2: five OC prompts (A8 order): migration+types, token v2, 2-D matrix, reduce, finalize/reaper
- [x] Comments silent loss: RCA (Upstash SET envelope) → #373 merged; TTL heal → PR #374; 8 channelMeta rows repaired in prod
- [~] Comments backfill: script in PR #381 (count pre-flight; dry-run 41 enqueueable, 4 zero). USER runs --apply with prod HMAC secret; CC verifies pilot (run completed, classifications, commentInsights, cost)
- [ ] Jev policy (user): Jev is THE model for classification/decisions. ADR 037 Layer 0 code is pure math (no Jev call) — keep; evaluate Jev as augmentation/replacement once real data exists
- [ ] Privacy: TypeSafe (via OpenRouter) on sub-processor list before launch
- [ ] **NEW: highlights reel** — caption ticker too fast / out of sync with speech; manual jump to a highlight (e.g. #10 on the Sabrina Romanov video) doesn't play, auto-advance does
- [ ] History thumbnail: mockup v2 (image layer -1, fade past divider, divider on top, text over with shadow) — awaiting user look
- [ ] System-wide radius: 8px panels/inputs/buttons/rows, 6px chips; chat focus = subtle border; header search = Simple/Pro height; fix clipped dimension cards
- [ ] Follow-ups in ledger: #368 (9/11 split signing, polling deadline), R1c quota tests, OC tooling wave, highlights share_token bug, R2.5 sweep, R5 chat 8.4 cut

- [ ] PR #381 CAS + backfill script — CI green, awaiting merge
- [ ] PR #382 history row v3 — CI green, user eyeball on prod after merge
- [ ] PR #383 Dispatch B (OC + CC gate fixes) — CI running
