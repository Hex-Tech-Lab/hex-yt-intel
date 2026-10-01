# Session TODO — see docs/history/THOS_2026-10-01_R3B_PLAN_TOKEN_REDUCER_COMMENTS_UI.md §1.5–§2 (authoritative)

## Open (2026-10-01 handover)
- [ ] 2.3C client plan consumer: OC run in flight at handover (worktree hex-yt-intel-r3b-23c) → verify / relaunch once → PR
- [ ] PR #392 (2.3W, draft): OC route-level tests (plan event before first token, LLM still runs after /plan failure, projective skip) → merge
- [ ] #388 hardening: sign bundle-partition digest; reject unknown tokenVersion; HMAC-only test cases
- [ ] #390: real truncation for truncatedFallback (before Jev enabled)
- [ ] 2.3.5 multi-chunk token pre-signing (after 2.3W/C + #388 fix)
- [ ] R3b 2.5 PARKED (WIP 0b102617) + #387 items that belong to 2.5
- [ ] Comments backfill NOT RUN in prod (user must run with prod STREAM_HMAC_SECRET; paste output; CC verifies DB)
- [ ] hex-expan commit guard: user to decide port vs fix
- [ ] Worktree cleanup; privacy (TypeSafe sub-processor); highlights reel sync

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
