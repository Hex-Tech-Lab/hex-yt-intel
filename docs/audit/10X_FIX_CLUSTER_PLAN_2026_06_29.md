# 10X FIX-CLUSTER PLAN — 2026-06-29 (companion to RE-AUDIT 2026-06-29)

**Status**: DRAFT / proposal — no code changed. Derived from the re-audit + 2 deep fix-design passes (worker, persistence) + live DB/Vercel/qa-intel verification.
**HEAD**: `df60965` · **Branch**: `claude/full-spectrum-re-audit-qzk3kw`
**Gating philosophy**: lean on **qa-intel** as the enforced gate (free, repeatable) and stop depending on free-tier PR bots (Sourcery/CodeRabbit/cubic) for correctness.

Effort key: S ≈ <1h · M ≈ half-day · L ≈ 1-2 days. ▶ = merge-blocker.

---

## SEQUENCING (recommended PR split)

| PR | Cluster | Why this order | Blocker |
|----|---------|----------------|---------|
| PR-1 | **W — Worker crash + security + tsc gate** | Stops a production `ReferenceError` + removes known HMAC secret; the gate makes it stick | ▶ |
| PR-2 | **P — Persistence finalize + reaper** | Recovers 36 stuck analyses (52%) + stops new ones stranding | ▶ |
| PR-3 | **D — DB hardening migration** | Closes anon-callable privileged RPC + RLS perf + drift | ▶ (RPC) |
| PR-4 | **F — Frontend correctness** | Render-purity + INP regression + a11y | — |
| PR-5 | **Q — qa-intel gate + process hardening** | Makes "green" trustworthy; replaces bot reliance | — |
| PR-6+ | **X — Simplification + hygiene** | Conductor delete, adapter collapse, swallowed-error batch | — |

Land PR-1 and PR-2 first; they neutralize all three NEW criticals.

---

## CLUSTER W — Worker correctness & security  ▶ (PR-1)

Root enabler: worker builds via `esbuild --bundle` with **no typecheck** → 12 real type errors ship.

| # | file:line | Fix | Effort | ▶ |
|---|-----------|-----|--------|---|
| W1 | `worker/src/routes/analysis.ts:420-453` | **DELETE** the orphaned client-disconnect block. It references `settled`/`persistService` (locals of `buildStreamResponse`) → `ReferenceError` on every disconnect, and duplicates the *working* abort path in `atomic-persist.ts:70-82`. Keep L416-418 (`persistController`/`persistSignal`) + L455 call. Relocating = HIGH double-persist risk (orphan clobbers partials with empty `interrupted` rows). | S | ▶ |
| W2 | `analysis.ts:202,209` + `PersistService.ts:10` | Persist-timeout block: widen `PersistOptions.status` union to `'completed'|'interrupted'|'failed'` (L202 sends `'failed'`); pass `persistController` (not the bare `AbortSignal`) into `buildStreamResponse` so `persistController.abort()` is valid at L209. | S | ▶ |
| W3 | `worker/src/services/MetadataScraper.ts:58,59,106` | Type the YouTube `snippet` fields (`{title?:string;description?:string}`) + `??` defaults; guard `data.items[0]` (undefined under `noUncheckedIndexedAccess`) before `parseMetadata`. Latent null-deref. | S | ▶(gate) |
| W4 | `worker/src/services/user-agent.ts:15` | `USER_AGENTS[Math.floor(...)] ?? USER_AGENTS[0]!` — index access is `string|undefined`. | S | — |
| W5 | `worker/src/chat-stream.ts:239-241` | **HIGH-1**: delete the `dev-hmac-secret-123` fallback. Anyone with the (checked-in) constant forges chat tokens on any non-prod deploy → free OpenRouter use + forged persistence. Legit dev path already exists via `DEV_HMAC_SECRET` env (L235-237). Document: preview envs must set the CF secret. | S | ▶(sec) |
| W6 | `analysis.ts:391-409` + `chat-stream.ts:261-275` | **HIGH-4**: collapse the non-prod branch to a single `return c.json({error:"Invalid token"},401)`. Currently leaks the exact HMAC pre-image (`msg`) + provided `sig` to the client — an oracle that compounds W5. Keep only a redacted server-side `console.warn` (lengths, not values). | S | ▶(sec) |
| W7 | new `worker/tsconfig.typecheck.json` + `worker/package.json` + `.github/workflows/{deploy-worker,ci-cd}.yml` | **The enforcement deliverable.** `extends ./tsconfig.json`, `declaration:false` (kills 46 TS6059), `lib:["ES2022"]`, `exclude` test trees (kills 16 jest/vitest errors). Add `"typecheck":"tsc --noEmit -p tsconfig.typecheck.json"`; add a **blocking** step to the PR `type-check` job AND pre-deploy in `deploy-worker.yml`. Verify the 3 cross-import `window` errors vanish; if not, fix in `web/lib` (guard `typeof window`), NOT by adding DOM lib to the worker. Land after W1-W4 so first run is green. | M | ▶ |
| W8 | `CLAUDE.md` Law #2 + `worker/src/services/LLMCascade.ts:84,145` | Doc says 3s/25s/90s; code is 15s handshake / **120s** total. The 120s timer is **unreachable** — CF wall-clock budget ≈58s (Law #4), so the platform kills the request before the timer (abrupt, no graceful `'failed'`). Lower total `120000→50000` (fires gracefully) and rewrite the doc to 15s/~50s. | S | — |

Net: small LOC change; removes a prod crash class + a forge-able secret + an HMAC oracle, and makes the worker un-shippable while broken.

---

## CLUSTER P — Persistence lifecycle & data recovery  ▶ (PR-2)

Mechanism of the 52% stuck: browser fans out **5 concurrent streams** (`useSSEStream.ts`), each POSTs to `/persist`; **there is no trailing "final" POST**. Finalization is attempted inline per-POST; the exact-match check races (chunks not yet visible), and the 30s grace window only re-evaluates *on a later POST that never arrives* → permanent `processing`.

| # | file:line | Fix | Effort | ▶ |
|---|-----------|-----|--------|---|
| P1 | `web/app/api/analyses/persist/route.ts:177-196` + `SupabasePersistenceAdapter.ts:119-130` | **Self-finalize**: finalize the moment the union of completed chunks satisfies `{1..TOTAL_STREAMS}` (or quorum), via a **single-winner conditional** `UPDATE … WHERE billing_status<>'completed'` (check rowcount) so concurrent POSTs don't double-finalize/double-cache. | M | ▶ |
| P2 | new `web/app/api/webhooks/reaper/route.ts` + `scripts/setup-qstash-cron.ts` | **Reaper** (every ~10 min, HMAC-verified like `dream-sequence`): sweep `processing` rows `updated_at < now()-5min`, run a **shared `finalizeAnalysis(id)`** helper (extracted from the inline path so they can't diverge). Recoverable → complete; stale/no-chunks → `failed`. Recovers the live 36 + future. | M+S | ▶ |
| P3 | `SupabasePersistenceAdapter.ts:119-157` | **HIGH-3 + ordering**: do KG/side-writes **before** flipping `billing_status='completed'`; remove the `.catch(err=>console.error)` swallow at L154-156. On KG failure leave `processing` → reaper retries (vs shipping a "completed" analysis with no graph). | M | ▶ish |
| P4 | `SupabasePersistenceAdapter.ts:159-176` | **Delete** the dead `content_text`/`metadata_payload` chunk write — live `analysis_chunks` has **neither column** (verified: only `id,analysis_id,chunk_index,dimensions_covered,payload,status,created_at,updated_at`). Canonical writer is `persistAnalysisChunk` (L282-291). Silent-fail landmine. | S | — |
| P5 | `WorkflowConductor.ts:69-122` + `workflow-conductor.test.ts:84-366` | **Delete dead code** (do NOT gate-for-real). `executeSingleVideo`/`executeCrossAnalysis` have zero callers; `routeToRoom` is a no-op trace wrapper; the 471-LOC test never instantiates the conductor (Zod-only). Keep/inline only the persist trace wrapper. ≈ **−350…−400 LOC**. | M | — |
| P6 | `SupabasePersistenceAdapter.ts` (whole) | Collapse the 36-method/355-LOC aggregator: relocate the ~5 real-logic methods into their domain sub-adapters, replace ~30 one-line delegations with composition. ≈ **−300 LOC** (mostly relocated). Separate refactor PR — wide blast radius. | L | — |
| P7 | one-off backfill script | **Legacy `chunk_index 6-11`** (verified live `max=11` vs code `TOTAL_STREAMS=5`): stitch over the *union* of present indices (not 1..5) then finalize; mark `failed` where 1-5 incomplete. Data migration, not hot-path. | M | — |

> **ADR 007 — Persistence Reaper & Self-Finalizing Stitch (proposed).** Context: concurrent 5-stream persist has no trailing POST; grace window dead → 52% stuck. Decision: (1) inline single-winner conditional finalize; (2) HMAC-verified QStash reaper sweeping stale `processing` rows via shared `finalizeAnalysis()`; unrecoverable → `failed`. Idempotency: `WHERE billing_status<>'completed'` everywhere + 5-min staleness filter. Consequence: rows self-heal within one sweep; cache-write/validation-publish must sit behind the same single-winner guard.

P1+P2+P3 are interdependent — ship together around the one shared `finalizeAnalysis()`.

---

## CLUSTER D — Database hardening  ▶ (RPC) (PR-3, single migration)

| # | Target | Fix | Sev |
|---|--------|-----|-----|
| D1 | `reserve_analysis_quota` | **`REVOKE EXECUTE … FROM anon, authenticated, public; GRANT … TO service_role;`** Live grantees verified = `service_role,authenticated,anon,postgres,PUBLIC` — the lone anon-callable SECURITY DEFINER inserter (all 6 others correctly locked). | HIGH |
| D2 | RLS init-plan | Wrap bare `auth.uid()` → `(select auth.uid())` on `kg_entities`, `kg_relations` (`20260610110000:37,47`), `analysis_chunks` (`20260613134000:12`). Per-row re-eval; rest of schema already wrapped. | MED(perf) |
| D3 | `analysis_chunks` columns | (Covered by P4 — code aligns to real columns; no DDL needed unless you choose to *add* `content_text`.) | MED |
| D4 | `health_ledger` | Decide: keep `to public using(true)` (uptime is intentionally public) or scope to `authenticated`. Currently anon-readable, no justifying comment. | MED |
| D5 | `users` FK | `ALTER TABLE … VALIDATE CONSTRAINT users_id_fkey` (added `NOT VALID`, never validated). | LOW |
| D6 | `reserve_analysis_quota` archive | Conflicts archived via `video_id||'_archived_'||epoch` — unbounded row growth per re-analysis; add cleanup or rethink. | LOW |
| D7 | indexes | Add covering index on `kg_relations.target_entity_id` (composite is source-leading); drop genuinely-unused (`idx_usage_logs_metadata_gin`+`_latency` redundant). Validate against live `pg_stat_user_indexes` first (some "unused" are low-traffic-legit). | LOW |
| D8 | auth config | Enable leaked-password protection (GoTrue dashboard — not in repo). | LOW |

---

## CLUSTER F — Frontend correctness & a11y (PR-4)

| # | file:line | Fix | Sev |
|---|-----------|-----|-----|
| F1 | `DashboardContainer.tsx:125-127` | **HIGH-7**: move `hasHadVideoRef.current=true` out of render body into `useEffect` (render-phase mutation tears under concurrent/Strict). | HIGH |
| F2 | `useEagerVideoMetadata.ts:15-64` | **NEW regression (9405130)**: restore a cheap synchronous `extractVideoId` early-return *before* `abort()`+new `AbortController`, so keystrokes on unparseable/cached URLs don't abort valid in-flight requests. | HIGH |
| F3 | `store/useInputStore.ts` | **qa-intel HIGH (INP)**: remove synchronous validation from the state setter; validate at submit/analyze time. The real INP source the telemetry PR missed. | HIGH |
| F4 | `MindMap.tsx:26-35` | **MED-5**: hoist `typePriority` constant to module scope → removes per-render allocation + the exhaustive-deps tension at L110/166. | MED |
| F5 | `ChatDock.tsx:59-105` | **HIGH-9**: the `cancelled` guard covers DOM effects but not the store-mutating `loadConversations`/`selectConversation`; gate those too or move to an action. | MED |
| F6 | `LandingThree.tsx` | **qa-intel HIGH**: add graph data to the canvas render-effect dep array (stale render). | MED |
| F7 | `api/auth/signin/route.ts` | **qa-intel HIGH**: POST→GET redirect should be **303**, not 307 (307 preserves POST). | MED |
| F8 | `ChatDock.tsx:52-57`, skeletons, accordion | **HIGH-8** lint dep (benign, stable action — fix for cleanliness); add `aria-busy/role=status` to "Preparing synthesis…" skeleton; add `aria-expanded` to accordion/thread-toggle buttons. | LOW |
| F9 | `DashboardContainer.tsx` (563 LOC) + `rightPanelItems` memo | **HIGH-12**: extract `useDashboardPanels`/`usePanelExport`; split selection state out of the 4-item memo so node-hover doesn't re-render WordCloud/MindMap. | LOW-MED |

---

## CLUSTER Q — qa-intel as the enforced gate + process (PR-5)

| # | Target | Fix |
|---|--------|-----|
| Q1 | `scripts/verify-quality-engine.ts:189-191` | **`exit(1)`** (not 0) when ts-morph fails to load — today a green check can mean "scanned nothing." |
| Q2 | engine severity gating | Treat **`high` as blocking** (or add a `critical` tier and map the systemic patterns to it). Today 61 high → exit 0; PR #98's "0 blocking" was true only by threshold. |
| Q3 | `ci-cd.yml:112` | Pass `--ci` explicitly instead of relying on implicit `CI` env. |
| Q4 | `QualityEngine.analyze` / `engine.ts:70-76` | Surface per-rule/per-file errors (count + fail) instead of `console.error`+continue — a throwing rule currently yields zero findings + exit 0. |
| Q5 | `ci-cd.yml` (all jobs) | Scope `fetch-depth:0` to the diff jobs only (b054632's stated-but-unfulfilled intent); shallow-clone type-check/build/deploy. |
| Q6 | `.memory/AGENT_LEDGER.md:290` | Reconcile rule count 40 → **42** (arch 11 + sec 9 + stream 7 + persist 5 + ui 10). |
| Q7 | branch protection | Require review-thread triage before merge (PR #97 merged with ~74/100 sampled threads unresolved). With Q1-Q4, qa-intel becomes the load-bearing gate and the free-tier bots become advisory. |
| Q8 | `scripts/quality-engine/rules/*RuleEngine.ts` | Delete the duplicate `*RuleEngine.ts` modules (abandoned refactor; `index.ts` only exports the lowercase set). |

---

## CLUSTER X — Hygiene / swallowed-error batch (qa-intel-driven) (PR-6+)

Backed entirely by the qa-intel full scan (108 findings) — no PR-bot quota needed:

- **Empty-catch ×16 / `.catch(()=>{})` ×14**: add `console.error('[ctx]', e)` at minimum (ChatDock, KnowledgeGraphCanvas, useSSEStream, useChatStore, supabase, youtube, persist/route, WorkflowConductor…). Triage which should surface to the user.
- **Missing `finally` for I/O ×24** (20 files): wrap I/O in try/finally for cleanup — batch sweep.
- **Secrets-in-telemetry ×9** (stripe/webhook, SupabaseAnalysisAdapter, sentry-telemetry, CreateAnalysisUseCase, chat-stream): **triage real-vs-FP** (fields named `token`/`secret` to console); redact confirmed ones.
- **Path-traversal ×5**: 4 are **false positives** on static legal `page.tsx` (engine over-fires); only `analyses/[id]/export/route.ts` needs a real look. Consider a qa-intel rule refinement to skip static route files.
- **Dead 0-byte stubs**: delete `web/route.ts`, `web/server.ts`, `web/client.ts`.
- **DecodoAdapter**: PR #97 claimed removal but it's referenced in 7 files — finish the removal or stop claiming it.
- **Stale artifacts**: drop committed `snyk_web_results.json`/`snyk_worker_results.json` (0-vuln, misleading) or regenerate in CI.
- **Doc drift**: reconcile CLAUDE.md Frozen Stack — pnpm `11.1.3→11.9.0`, TypeScript `5.6.2→6.0.3` (major), Tailwind `4.3.0`. Add `worker/package.json` `engines` + repo `.nvmrc`; pin `staging-deploy.yml` Node to patch.
- **Lint**: add `--max-warnings 0` policy to stop the 27→32 ratchet (after clearing the 32).

---

## DEPENDENCY TRIAGE (the "11 Dependabot")

- **Locally verified (`pnpm audit`)**: exactly **1 — `ajv` ReDoS `<6.14.0` (MODERATE)**, *self-inflicted* by the root `overrides` pin `ajv@6.12.6` (added in PR #98 to fix the eslint crash). ReDoS reachable only via the `$data` option (eslint doesn't use it) → low real risk, but Dependabot will keep flagging. Decision needed: accept (document) vs find an eslint path off ajv 6.12.6.
- **Cannot enumerate the full 11 from here** — this GitHub MCP has no `list_dependabot_alerts` tool; alerts are behind the authenticated Security tab. The 11-vs-1 gap is expected (Dependabot = GHSA + all transitive dev deps; `pnpm audit` = npm registry advisories, possibly proxy-limited).
- **Next step**: paste the Dependabot list (package + severity) → each mapped to direct/transitive, fixability (override/bump/no-fix), and real reachability.

---

## TOTALS

- **Merge-blockers** (next cycle): W1, W2, W5, W6, W7, P1, P2, P3, D1.
- **Net LOC**: Cluster P alone ≈ **−650…−750** (conductor + adapter) offset by ≈ **+150** (reaper). Worker ≈ net-neutral. Quality clusters reduce surface further.
- **Biggest single ROI**: W7 (worker `tsc` gate) + Q1-Q2 (qa-intel exit-codes) — together they make "green CI" mean something, which is the systemic theme behind all three new criticals.

*Draft — report-only. No code or migrations applied.*
