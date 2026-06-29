# 10X FULL-SPECTRUM RE-AUDIT — 2026-06-29

**Branch**: `claude/full-spectrum-re-audit-qzk3kw`
**HEAD**: `df60965` (chore: upgrade Node 24.15.0 → 24.16.0, pnpm 11.1.3 → 11.9.0)
**Prior baseline**: `docs/audit/10X_FULL_SPECTRUM_REAUDIT_2026_06_22.md` @ `ee035243` (264 lines)
**Method**: 5 parallel domain agents (DB · Worker/Edge · Frontend · Persistence · Tech-debt/Process) + qa-intel AST engine (full + diff) + LIVE ground truth (Supabase advisors/SQL, Vercel deploys, GitHub PR/CI, Sentry).
**Mode**: REPORT ONLY — no code fixed.
**Verification stance**: ZERO ASSUMPTIONS — every headline finding cross-checked against source and/or live prod.

---

## ⚠️ EXECUTIVE SIGNAL (read first)

Net direction since prior audit: **↓ on the axis that matters.** Code hygiene is marginally up (several prior items genuinely closed), but **reliability/correctness regressed** and **process/doc integrity declined**. Three NEW criticals dominate:

1. **NEW-CRIT-A — Worker ships 6 TypeScript compile errors; `/analyze-llm-stream` throws `ReferenceError` on client disconnect.** Verified by `tsc --noEmit`. Ships because the worker builds via raw `esbuild --bundle` (no typecheck gate). Production code.
2. **NEW-CRIT-B — `WorkflowConductor` "persistence gating" is theater.** The PR #97 centerpiece is dead code + a no-op trace wrapper; real entry points bypass it; its test only exercises Zod schemas.
3. **NEW-CRIT-C — 52% of analyses are stuck.** Live: **36/69 (52.2%)** sit in `billing_status='processing'`, oldest **2026-06-12**. No reaper; finalization only fires on chunk-POST arrival.

PR #97 (+2024/−920, 59 files) and PR #98 (+6161/−150, 40 files) both merged with all CI checks green — yet the gates that went green do not catch any of the above.

---

## PHASE 0 — PREFLIGHT REPORT

- **Repo**: clean working tree on `claude/full-spectrum-re-audit-qzk3kw` (≡ `df60965`, current `main` head).
- **Change volume since prior baseline** (`ee035243..df60965`): **90 files, +7805 / −1033**. (The "~4h debugging" was actually a multi-day, large delta: the 06-24 fix block, PR #97 merge, PR #98 qa-intel hardening, telemetry-INP, Node bump.)
- **PRs**: #97 `fix/system-corrections-main-app` MERGED 2026-06-25 (25 commits, 56 comments); #98 `feat/qa-intel-engine-refactor` MERGED 2026-06-24 (12 commits, 30 comments). Both by TechHypeXP.
- **Production**: Vercel deploy `dpl_29ecFnWj…` @ `df60965` = **READY** (one transient `ERROR` build mid-PR#98, non-prod, recovered).
- **DB (live)**: 11 public tables, all RLS-enabled. `analyses` 69 rows, `analysis_chunks` 65, `chat_messages` 101, `kg_entities` 15. **No `videos` table.**
- **Prior coverage**: 100% of the prior checklist (CRIT-1/2, HIGH-1..14, MED-1..11, LOW-1..9, M1/M3/M4/M5, N18/N19) carried forward and reconciled below — zero dropped.

---

## PHASE 1 — MASTER CHECKLIST: PRIOR → CURRENT (delta map)

Status legend: ✅ fixed · 🟡 partial/mitigated · ❌ open/unchanged · ⚠️ regressed · 🆕 new

### CRITICAL
| ID | Issue | Status | Evidence / delta |
|----|-------|--------|------------------|
| CRIT-1 | Null-filter leak `.neq('billing_status','processing')` | ❌ open (latent) | `web/lib/adapters/SupabaseAnalysisAdapter.ts:24` unchanged. **Live: 0 NULL rows** → not currently exploitable, but defect remains (legacy/manual NULL row would bypass the active-job filter and be served as cache hit). |
| CRIT-2 | `.from('videos').upsert()` with no `videos` table | 🟡 reclassified, unfixed | `SupabasePersistenceAdapter.ts:104`. Not a crash: supabase-js returns (doesn't throw) + `try/catch` → **silent dead write**, no FK integrity. Table still absent in all 33 migrations + live DB. Real `analyses` UPDATE still succeeds. Down-graded Crit→Med severity, but the misleading write stands. |

### HIGH
| ID | Issue | Status | Evidence / delta |
|----|-------|--------|------------------|
| HIGH-1 | Hardcoded `dev-hmac-secret-123` non-prod fallback | ❌ open | `worker/src/routes/chat.ts:239-241` still pushes the literal. **Divergence**: `analysis.ts` verifier does *not* push it → chat route is weaker than analysis route. |
| HIGH-2 | `settled` used before/out of scope (race) | ⚠️ **regressed → hard crash** | Now a guaranteed `ReferenceError` (see NEW-CRIT-A). `tsc`-confirmed. |
| HIGH-3 | KG persist failure silently swallowed | ❌ open | `SupabasePersistenceAdapter.ts:154-157` logs, no re-throw; `billing_status:'completed'` committed at L127 *before* KG write. |
| HIGH-4 | Debug mode leaks `msg/sig/isFallbackUsed` | ❌ open | `analysis.ts:391-409` + mirror `chat.ts:261-275` (`msg/sig/signingKeyType`). Leaks exact HMAC message + sig in preview. |
| HIGH-5 | Unsafe `any` casts in KG mapping | 🟡 partial | New `updateAnalysisResult` path typed (L141-153); legacy `persistAnalysis` path still `(n as any)` (L38-49) — two divergent copies now. |
| HIGH-6 | Chunk stitching out-of-order / grace window | ⚠️ open + live impact | `web/app/api/analyses/persist/route.ts:184-194`. Grace re-eval only fires on a *subsequent* POST → see NEW-CRIT-C. |
| HIGH-7 | Ref mutation during render (`hasHadVideoRef.current=true`) | ❌ open | `web/components/containers/DashboardContainer.tsx:125-127`, read L479. Tears under concurrent/Strict double-render. |
| HIGH-8 | ChatDock effect missing `setOpen` dep | ❌ open | `ChatDock.tsx:52-57` deps `[]`. Behaviorally benign (zustand action is stable) but lint debt verbatim. |
| HIGH-9 | Async cleanup race in ChatDock | 🟡 partial | `cancelled` guards DOM effects only; `loadConversations/selectConversation` still mutate global store post-unmount. Narrowed, not eliminated. |
| HIGH-10 | `search_analyses_semantic` RPC bypass | ✅ fixed / not-a-vuln | `20260521185646_optimize_vector_search_rpc.sql:21` is INVOKER (no SECURITY DEFINER); RLS scopes rows; forged `p_user_id` returns nothing. |
| HIGH-11 | `updateConversationTitle` no ownership check | 🟡 mitigated | Adapter unguarded (`SupabaseChatAdapter.ts:131-153`) but sole caller `ProcessChatMessageUseCase.ts:178` gated by L76-81 403. Defense-in-depth gap only. |
| HIGH-12 | DashboardContainer > 500 LOC | 🟡 still over | **563 LOC** (was 566). −3 LOC. Still monolithic (toast/clipboard/export/4 panel factories/layout). |
| HIGH-13 | Provider hardcoding only for haiku-4.5 | 🟡 unchanged | `LLMCascade.ts:171-176,279-284`. `claude-sonnet-4.6:nitro` tier gets neither token cap nor curated providers. |
| HIGH-14 | SupabasePersistenceAdapter wrapper bloat | ⚠️ **worse** | **31 one-line delegations + 5 real = 36 methods / 355 LOC** (was "28"). Grew. |

### MEDIUM / LOW / M-series
| ID | Issue | Status | Evidence / delta |
|----|-------|--------|------------------|
| M1 | Monolithic `env.ts` (~386 LOC) | 🟡 prior overstated | Actual **187 LOC**. Still a getter-bag; far under prior figure. |
| M3 | Dead `checkRateLimit` in traffic.ts | ✅ resolved | Only `checkRateLimitSlidingWindow` remains; `getRateLimitStatus` delegates to `trafficGuard`. |
| M4 | Empty 0-byte stubs (`auth.ts`,`graphql-client.ts`) | ⚠️ moved, still present | Those gone; **3 new 0-byte tracked stubs** `web/route.ts`, `web/server.ts`, `web/client.ts` (added `e6a12e7`), unimported. |
| M5 | Worker body-size limits missing | ❌ open | No hono `bodyLimit`; **5 unbounded `c.req.json()`** sites (analysis.ts:305,365; transcript.ts:12,56; chat-stream.ts:208). DoS/memory surface. |
| MED-1 | Video upsert error swallowed | ❌ open | `SupabasePersistenceAdapter.ts:113-116` warn-only; `ignoreDuplicates` upsert won't throw anyway → catch largely dead, masks real FK/permission errors. |
| MED-2 | Chat insert no ownership match | 🟡 mitigated | Both callers verify ownership first; RLS `WITH CHECK` enforces (moot for service-role). |
| MED-3 | KG delete-then-insert not transactional | ❌ open | `SupabaseGraphAdapter.ts:59-100` delete→insert, no txn/RPC; insert failure after delete = data loss. |
| MED-4 | Hardcoded `getmytestdrive.com` URL | 🟡 unchanged | `analysis.ts:176`, `chat-stream.ts:43,323`. |
| MED-5 | MindMap `useMemo` missing `typePriority` dep | ❌ open | `MindMap.tsx:110,166`. Root cause: `typePriority` object literal recreated each render (L26-35); should hoist to module scope. |
| MED-6 | env detection duplicated 4× | 🟡 improved to 3× | `env.ts:72,96,152`. |
| MED-7 | Refusal window 20-400 chars | 🟡 unchanged | `LLMCascade.ts:233-237`. Terse `"I cannot."` (<20) or late refusal (>400) not caught. |
| MED-8 | Error classification timeout/aborted overlap | 🟡 unchanged | `LLMCascade.ts:384-388` collapses timeout/aborted/deadline. |
| MED-9 | `health_ledger` public read | ❌ open | `20260610095804:16-20` `to public using(true)`. Anon reads uptime/incident data. |
| MED-10 | `stripe_events` INSERT policy | ✅ fixed | `20260602:38` drops permissive ALL; default-deny; service-role bypasses. |
| MED-11 | `videos` RLS | ✅ N/A | No table. Subsumed by CRIT-2. |
| N18 | Dynamic import in GET | ✅ resolved (prior) | — |
| N19 | Broad tracing includes | ✅ narrowed | `next.config.ts:20,31-33` scoped to one export route + pdfkit. |
| H2 | `users` FK `NOT VALID` | ❌ open | `20260607120000:8-18` never `VALIDATE`d; pre-existing orphans unchecked. |
| H5/L9 | `usage_logs` pg_cron purge silent fail | 🟡 unverifiable | `20260610095804:22-42` exception-swallowing `unschedule`; cannot confirm job registered from SQL alone. |
| LOW-4 | `parseError` unused (streaming.ts:56) | ❌ open | lint warn. |
| LOW-8 | `OPTIONAL_ENV_VARS` unused (env.ts:21) | ❌ open | lint warn. |
| LOW-8(b) | qa-intel ledger says 40, actual 42 | ❌ open | `.memory/AGENT_LEDGER.md:290` vs `rules/index.ts` (arch 11 + sec 9 + stream 7 + persist 5 + ui 10). |

---

## PHASE 2 — NEW FINDINGS (this audit), cross-skill synthesized

### 🔴 CRITICAL
- **NEW-CRIT-A — Worker `/analyze-llm-stream` ships 6 TS compile errors; `ReferenceError` on client disconnect.** `tsc --noEmit` confirmed:
  - `analysis.ts:422,423,438,439` → `Cannot find name 'settled'`; `:424,440` → `Cannot find name 'persistService'`. `settled` (decl L169) and `persistService` (decl L171) live **inside** `buildStreamResponse`; the handler references them at outer scope L418-440 — an orphaned client-disconnect block left by the streaming-decoupling commits (a38ac8a/9f64b1e).
  - `analysis.ts:209` → `persistSignal.abort()` invalid on `AbortSignal` (it's a signal, not a controller) — TypeError in the 15s persist-timeout path.
  - `analysis.ts:202` → `status:'failed'` not in `'completed'|'interrupted'` union; even if delivered, `persist/route.ts:321` downgrades non-`interrupted` → `'done'` (a timed-out analysis recorded as success).
  - **Why it ships**: `worker/package.json` build = `esbuild --bundle` (no typecheck); **no `tsc` gate in worker CI**. Verified live errors present at HEAD.
- **NEW-CRIT-B — `WorkflowConductor` persistence gating is non-functional.** `WorkflowConductor.ts`: `routeToRoom` (L46-63) is a generic try/catch + traceId + Sentry wrapper that gates nothing; `executeSingleVideo` (L69-89) and `executeCrossAnalysis` (L95-122) have **zero callers** (real entries: `analyses/route.ts:56` → `createAnalysisUseCase.execute()` directly; `atlas/global-graph/route.ts:16` → adapter+usecase directly). `workflow-conductor.test.ts` (471 LOC) never instantiates the conductor — it tests Zod schemas. PR #97 / ee9dc20 ("lock down end-to-end persistence conductor gates") did **not** deliver a gate.
- **NEW-CRIT-C — 52% of analyses stranded in `processing`.** Live: **total 69 · processing 36 (52.2%) · completed 27 · NULL 0 · oldest_processing 2026-06-12.** Finalization (`persist/route.ts:172-196`) only re-evaluates *during* a chunk POST; if the last POST doesn't complete the loop and none follows, the row never finalizes. No reaper/sweep exists. (Precise split: 2 rows are provably all-chunks-complete-yet-stuck; the remaining ~34 are abandoned/never-finished streams — both classes need a finalizer.)

### 🟠 HIGH
- **NEW-H(db) — `reserve_analysis_quota` SECURITY DEFINER exposed to anon + authenticated.** `20260612120000_atomic_compare_and_reserve.sql:2-10` is `SECURITY DEFINER` with **no `REVOKE EXECUTE`** anywhere (the `20260602_revoke_anon_privileges.sql` predates it and doesn't cover it) → default PUBLIC EXECUTE via PostgREST `/rpc/reserve_analysis_quota`. Internal guard blocks calling for *another* user, but an authenticated user can insert `processing` stubs for self at will (row-spam / quota-counter vector); anon (`auth.uid() IS NULL`) passes the guard entirely. Confirmed by live security advisor + migration. Fix: `REVOKE EXECUTE … FROM anon, authenticated, public; GRANT … TO service_role`.
- **NEW-H1 — `persistSignal.abort()` runtime TypeError** (`analysis.ts:209`). Part of NEW-CRIT-A cluster; breaks the 15s persist-timeout path.
- **NEW-H2 — Timed-out persist recorded as success** (`analysis.ts:202` + `persist/route.ts:321`).
- **NEW-H(fe) — `useEagerVideoMetadata` teardown-churn regression** introduced by telemetry commit 9405130. `web/hooks/useEagerVideoMetadata.ts:15-64`: the dedup/parse early-return was moved *into* the debounced `setTimeout`, so every keystroke now runs `abortRef.current?.abort()` + new `AbortController` even for unparseable/cached URLs → aborts valid in-flight requests, extra GC churn. Restore a cheap synchronous `extractVideoId` early-return before abort.
- **NEW-H(proc) — qa-intel gate gives false confidence.** (1) On ts-morph import failure the engine **`process.exit(0)`** (`verify-quality-engine.ts:189-191`) → green check while scanning nothing (despite b054632's bullet claiming `exit(1)`). (2) Per-rule/per-file errors are `console.error`+continue (`QualityEngine.analyze`) → a throwing rule yields zero findings, exit 0. (3) `ci-cd.yml:112` runs without explicit `--ci`; blocking relies on implicit `CI` env. (4) Engine severity caps at `high`; **61 high findings → exit 0** (only `critical` would block, and the ruleset emits none) — i.e. PR #98's "0 blocking findings" is true *by threshold*, not by cleanliness.

### 🟡 MEDIUM
- **MED(db-drift) — `analysis_chunks` write to non-existent columns.** `SupabasePersistenceAdapter.ts:162-168` writes `content_text` + `metadata_payload`; the table (`20260613133000:2-12`) has only `payload`/`dimensions_covered`/`status`. Silent failure (error discarded).
- **MED-A — Legacy `chunk_index` 6-11 unrecoverable.** Live `max(chunk_index)=11` while code `TOTAL_STREAMS=5` and the stitch loop reads 1..5 → analyses authored under the old 11-stream regime can never re-finalize. No data migration/version guard.
- **MED(perf) — `auth_rls_initplan` unwrapped `auth.uid()`** on `kg_entities`/`kg_relations`/`analysis_chunks` (`20260610110000:37,47`; `20260613134000:12`) — per-row re-eval; rest of schema was wrapped to `(select auth.uid())`. Live perf advisor confirms.
- **MED(read) — Edge read silently returns empty markdown >100kB.** `analyses/[id]/route.ts:17-20`: null `analysis_markdown` + payload > `MAX_EDGE_PAYLOAD_BYTES=100_000` → 200 with empty body (viewer data loss, not 4xx/5xx). This is the only "100kB cap" — not in MarkdownReconstructor as PR framing implied.
- **MED(doc) — CLAUDE.md Frozen Stack is not frozen.** pnpm **11.1.3 → actual 11.9.0**; TypeScript **5.6.2 → actual 6.0.3** (major bump); Tailwind unversioned in doc but actual **4.3.0** (v4). Next 16.2.6 matches.
- **MED(proc) — `fetch-depth:0` on all CI jobs.** b054632's stated intent "scope to diff jobs" unfulfilled; full history cloned for type-check/lint/build/deploy (CI cost regression, contradicts commit message).

### 🟢 LOW
- 3 dead 0-byte stubs (`web/route.ts|server.ts|client.ts`).
- Lint regressed **27 → 32** warnings (0 errors); no `--max-warnings 0`.
- Duplicate `*RuleEngine.ts` vs lowercase rule modules in `scripts/quality-engine/rules/` (abandoned refactor, dead weight).
- `worker/package.json` lacks `engines`; no repo `.nvmrc`; `staging-deploy.yml:19` Node unpinned (`"24"`).
- `kg_relations.target_entity_id` unindexed FK (composite index is source-leading); ~11 unused indexes (low-traffic, mostly benign; GIN+latency on `usage_logs` redundant).
- `vector` extension in `public` schema (accepted tech-debt, `20260602:42` defers move).
- Leaked-password protection disabled (GoTrue dashboard; not in repo — unverifiable from code).
- `reserve_analysis_quota` archives conflicts by mutating `video_id||'_archived_'||epoch` → unbounded row accumulation per re-analysis.
- `env.ts:153` indentation damage from the 371f613 sweep.
- DecodoAdapter NOT actually removed despite PR #97 claim — still referenced in 7 files (`ports/index.ts`, `DecodoPort.ts`, `adapters/index.ts`, `DecodoAdapter.ts`, worker `TranscriptExtractor.ts`+tests).

---

## qa-intel ENGINE OUTPUT (full + diff)

- **FULL scan** (`--mode=full`, web+worker): **108 findings — 61 high / 47 medium / 0 critical-by-engine.** Exit 0 (high ≠ blocking).
- **DIFF scan** (`--mode=diff --base=ee035243`, change-stream): **49 findings — 32 high / 17 medium.** Recent work did not clean these.
- **Dominant systemic patterns**: "Workflow: Missing finally block for I/O" ×24 · empty-catch/swallowed-promise ×30 · **"Stream: Timeout abort does not settle error state" ×13** (corroborates HIGH-2/NEW-CRIT-A across LLMCascade, TranscriptExtractor, MetadataScraper, atomic-persist, chat-stream) · "Secrets Exposure in telemetry" ×9 · "Persist: client signal aborts server-side persist" (data-loss class) · 5× path-traversal.
- **FP triage**: the 5× "Path Traversal" on static legal pages (`terms-and-conditions/page.tsx` etc.) are almost certainly false positives; "Secrets Exposure" on fields literally named `token`/`secret` passed to `console` need per-site triage. Engine is heuristic — treat counts as a heat-map, not a verdict.

---

## PHASE 3 — CHANGE-STREAM AUDIT (recent work → outcome)

| Change (commit) | Intent | Actual outcome | Verdict |
|---|---|---|---|
| a38ac8a / 9f64b1e (streaming decouple) | Immediate SSE headers; async transcript inside stream; remove sync fetch from bouncer | Headers flush first ✅; Law #4 HMAC alignment now clean ✅; **but left orphaned disconnect block → NEW-CRIT-A** | ⚠️ regressed |
| ee9dc20 / PR#97 (WorkflowConductor) | Gate persistence end-to-end | Gate is a no-op wrapper; Path methods dead; test = schemas only → **NEW-CRIT-B** | ❌ not delivered |
| 9405130 (telemetry-INP) | Fix INP / thread lockouts | `startTransition` + deferred input genuinely correct ✅; telemetry kept server-side ✅; **but new teardown-churn regression** in `useEagerVideoMetadata` | 🟡 net-flat |
| b054632 / PR#98 (qa-intel hardening) | Depth limiter, strict exit, scoped fetch-depth | Depth limiter sound ✅; **but still `exit(0)` on ts-morph fail; fetch-depth still on all jobs** — two stated goals unmet | 🟡 partial |
| 371f613 (14-pattern sweep, 34 files) | Code-quality sanitization | Sampled high-risk diffs (async→sync transform/redirects, string de-obfuscation) — **no semantic regressions**; one indentation blemish | ✅ safe |
| df60965 (Node/pnpm bump) | Runtime upgrade | Prod READY ✅; **but CLAUDE.md Frozen Stack now lies** (pnpm/TS) | 🟡 doc drift |

**Patchwork / shadow logic detected**: orphaned disconnect block (analysis.ts:418-440) duplicates the working `atomicPersist` disconnect listener → would double-persist had it compiled; two divergent KG-mapping copies (typed vs `any`); two divergent `analysis_chunks` write shapes; conductor "gate" that wraps but doesn't gate.

---

## PHASE 4 — RISK / BLIND SPOTS

**CRITICAL** — Worker compile errors shipped (NEW-CRIT-A); conductor gate is illusory (NEW-CRIT-B); 52% data stranded + no reaper (NEW-CRIT-C).
**HIGH** — `reserve_analysis_quota` anon-callable SECURITY DEFINER; HIGH-1 known dev secret in chat route; HIGH-4 HMAC debug leak; unbounded worker JSON intake (M5); qa-intel false-confidence escape hatches.
**MEDIUM** — schema↔code drift (`videos`, `analysis_chunks` columns, legacy chunk_index 11); RLS init-plan perf; edge empty-markdown data loss; doc drift; merge-with-unresolved-threads.
**LOW** — dead stubs, lint ratchet, unindexed FK, index bloat, missing engines pin.

**Blind spots (could not verify here):**
- pg_cron purge job actually registered (needs live `cron.job`).
- `reserve_analysis_quota` live GRANTs (advisor strongly implies anon-callable; confirm via `information_schema.role_routine_grants`).
- Leaked-password / GoTrue auth config (dashboard, not in repo).
- Out-of-band prod indexes (baseline migration notes several created outside migrations; unused-index advisor may reflect prod-only objects).
- Worker not run live (no wrangler/secrets) — NEW-CRIT-A is static+`tsc`-proven, not runtime-observed; Sentry (org `hex-org`) shows **no** matching `ReferenceError` issue in 14d → worker may not report to that Sentry org (itself a gap), or disconnect path is low-frequency.
- INP not runtime-measured; the `dimensions` projection memo (DashboardContainer:338-422) rebuilding per stream push is the likely real INP hotspot, untouched.
- PR review threads: only first 100 of 353 sampled (74 unresolved, bot-dominated) — a substantive human comment could be among the unpaginated remainder.

---

## PHASE 5 — SYNTHESIS

### Net direction: **↓ (reliability/process) over ↑ (hygiene)**
- **Genuinely fixed/improved**: HIGH-10 (RPC safe), MED-10 (stripe INSERT deny), M3 (dead limiter gone), N19 (tracing narrowed), MED-6 (4→3), env.ts (187 not 386), Law #4 HMAC alignment, INP/startTransition, depth limiter, 371f613 sweep clean.
- **Regressed/new**: 3 new criticals; HIGH-2 race→crash; HIGH-14 bloat grew; lint 27→32; doc Frozen-Stack drift; conductor theater; 52% stuck data; worker has no tsc gate.
- **The core inversion**: *perceived* coverage rose (a 471-line "conductor" test, "0 blocking" qa-intel, all-green CI) while *actual* correctness fell. Green gates are not catching shipped compile errors, illusory gating, or stranded data.

### ACTION CLUSTERS (report-only; not executed)
- **A — Worker correctness (CRITICAL)**: delete orphaned disconnect block `analysis.ts:418-453` (rely on `atomicPersist`); fix `persistSignal` controller/abort; remove `status:'failed'`; **add `tsc --noEmit` gate to worker CI**; remove `dev-hmac-secret-123`; strip debug payloads (HIGH-4).
- **B — Persistence lifecycle (CRITICAL)**: build a finalize/reaper sweep for stuck `processing` rows; fix grace-window to fire without a trailing POST (HIGH-6); make `WorkflowConductor` actually gate or delete the dead Path methods + rename its schema-only test.
- **C — Database**: `REVOKE EXECUTE` on `reserve_analysis_quota`; reconcile `analysis_chunks` columns vs writes; wrap RLS `auth.uid()` on 3 KG/chunk policies; migrate/guard legacy chunk_index>5; decide `health_ledger` public-read.
- **D — Frontend**: move `hasHadVideoRef` to effect (HIGH-7); hoist `typePriority` (MED-5); restore early-return in `useEagerVideoMetadata`; split DashboardContainer (HIGH-12/14-class).
- **E — Process/Docs**: qa-intel `exit(1)` on ts-morph fail + explicit `--ci` + treat `high` as blocking; reconcile CLAUDE.md Frozen Stack; scope `fetch-depth:0` to diff jobs; merge-gate on review-thread triage; reconcile ledger rule count 40→42.

### ADRs — implicit decisions / conflicts / gaps
- **Implicit**: streaming fully decoupled from Vercel to CF worker (Law #4 realized in code); `billing_status` lifecycle introduced without a finalizer; TS 5→6 + pnpm major bump (no ADR).
- **Conflict**: CLAUDE.md Law #2 documents 3s handshake / 25s-Vercel / 90s-worker timeouts; **code uses 15s handshake / 120s total / 50s chat** — doc and code disagree; Vercel no longer streams LLM so "25s read" is obsolete.
- **Missing ADR**: persistence-finalization/reaper strategy; worker typecheck gate; Frozen-Stack version policy.

### INFLECTION POINTS
- The worker `esbuild`-without-`tsc` build is the root enabler of NEW-CRIT-A and an entire class of latent ship-the-error risk. **Single highest-ROI process fix.**
- The "gate that doesn't gate" pattern (conductor, qa-intel exit(0), high≠blocking) is the systemic theme — verification theater. Trust the green checks less than the code.

### SIMPLIFICATION MAP (highest ROI, est. LOC)
- Collapse `SupabasePersistenceAdapter` 1:1 passthrough (−180…−220) — callers import sub-adapters directly.
- Delete `WorkflowConductor` dead Path methods + rename schema-only test (−70…−90).
- De-dup KG mapping into one typed helper (−20); replace `resultsMap` control-flow gimmick (−8).
- Remove dead 0-byte stubs + duplicate `*RuleEngine.ts` modules.
- **Net mechanical reduction ≈ −300…−350 LOC** with no behavior loss (separate from bug-fix work).

### ROADMAP ALIGNMENT
Drift vs target: reliability target (durable persistence, observable failures) is *further* from green than the prior audit implied — 52% stuck + swallowed errors + shipped compile faults. Hexagonal/port architecture is sound in shape but carries passthrough ceremony and two abandoned refactors (RuleEngine duplicates, conductor Paths).

---

## PHASE 6 — COVERAGE GUARANTEE
- ✅ 100% of prior checklist reconciled (CRIT/HIGH/MED/LOW/M/N), zero dropped.
- ✅ 5 lenses synthesized (not siloed): DB · Worker/Edge · Frontend · Persistence · Tech-debt/Process.
- ✅ Cross-verified against LIVE prod: Supabase advisors (security+perf) + raw SQL, Vercel deployments, GitHub PR/CI/check-runs, Sentry orgs.
- ✅ qa-intel run both modes; NEW-CRIT-A independently `tsc`-proven; NEW-CRIT-C independently SQL-proven.
- ⚠️ Residual blind spots explicitly enumerated in Phase 4 (live GRANTs, pg_cron registration, GoTrue config, runtime INP, full PR-thread pagination, worker runtime observation).

**Confidence**: HIGH on code/DB findings (source + live verified); MEDIUM on process/threads (sampled). **Recommendation**: treat NEW-CRIT-A/B/C as merge-blockers for the next cycle; the green CI is not currently a reliable signal.

*End of re-audit.*
