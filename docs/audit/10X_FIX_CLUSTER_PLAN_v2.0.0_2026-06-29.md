# 10X FIX-CLUSTER PLAN — v2.0.0
**Date**: 2026-06-29 · **HEAD**: df60965 · **Supersedes**: `10X_FIX_CLUSTER_PLAN_2026_06_29.md` (v1)
**Status**: DRAFT / proposal — report-only, no code changed.
**Companions**: `QA_INTEL_ENGINE_ASSESSMENT_v1.0.0_2026-06-29.md` · `../specs/SETTINGS_SSOT_SCHEMA_v1.0.0_2026-06-29.md`

## What changed vs v1
- PRs **consolidated 6 → 4 pre-live** (+2 deferred post-live), **DB-first**, each sized to PR-review-tool limits.
- New clusters added: **SSOT/settings**, **Design (formatting + system)**, **Fabricated-Greens permanent remediation**, **Dependabot (undici)**.
- Governing constraints made explicit: **single source of truth**, **DDD-light + hexagonal-light end-to-end**, **no fabricated greens**, **stabilize-before-live** (defer big refactors).

---

## 0. GOVERNING PRINCIPLES (apply to every change)

1. **Single Source of Truth** — every variable value defined once (see SSOT spec). Changing one number must propagate everywhere via one import. No magic literals.
2. **DDD-light + hexagonal-light, end-to-end** — touch a path on one side → follow it through **port → adapter → use case → route/hook/worker**, all use-cases + edge-cases covered, nothing half-wired. Maintain the existing abstraction level + clear SoC; don't over-abstract.
3. **No fabricated greens** — a green check must mean the thing was actually verified. The 4 local checks (qa-intel → type-check → lint → security) must be *real* so we hit the PR bots with minimal friction, not a rosy lie. Permanent fix, not a patch (see §Cluster G).
4. **Stabilize before live** — pre-live PRs fix correctness/security/data/readability only. Large mechanical refactors (conductor delete, adapter collapse) are **deferred post-live** to avoid injecting risk days before launch.
5. **Cluster for 2-second triage** — clusters + SSOT + Sentry so any prod issue maps to one place fast (solo founder, no DevOps, zero margin for data/security regressions).

---

## 1. PR-REVIEW-TOOL LIMITS → PR SIZING STRATEGY

Repo is **public** → most bots are free for OSS; the real scarcity is **cubic (finite trial)** + **CodeRabbit hourly throttle**.

| Tool | Public-repo plan | Binding limit | Implication |
|---|---|---|---|
| **CodeRabbit** | Free for OSS | 3 back-to-back, then **4 PR reviews/hr/dev**, 200 files/hr, ~30s re-review cooldown | Space PRs; don't open >3-4/hr |
| **cubic** | **No free tier — ~40-review trial total** | finite, burning down | **Minimize PR count** — each costs 1 |
| **Sourcery** | **Free unlimited for OSS** | — | not a constraint |
| **Snyk** | **Free unlimited for OSS** (200/mo private only) | — | not a constraint |
| **Codacy** | Free for OSS, no scan cap | config/seat (`action_required` on #96) | needs a `.codacy.yml` |
| **Qodo** ("Kodo") | **75 PRs/month free** | monthly | fine at 4 PRs |
| CodeQL / CodeFactor | Free for public | — | — |

**Strategy**: **4 pre-live PRs**, opened **one at a time** — open PR-N, drive qa-intel + the 4 local checks green, resolve all bot threads, *then* open PR-N+1. This naturally respects CodeRabbit's 4/hr, conserves cubic's ~40, and prevents the PR-#97 failure mode (merged with ~74/100 threads unresolved). Keep each PR's diff focused (bots review better < ~50 files / < ~1500 LOC).
> Action: confirm cubic's remaining trial count + whether Codacy has flipped to paid (the founder flagged uncertainty) before opening PRs. Add `.coderabbit.yaml` (path filters + `review.auto_review` tuning) and `.codacy.yml` to cut bot noise/quota.

---

## 2. PR PLAN (DB-FIRST, CONSOLIDATED)

### ▶ PR-1 — DATABASE + SECURITY + DEPENDENCIES  *(open first; smallest blast radius, unblocks live security)*
Single migration + config. Bins everything DB-adjacent per founder direction.
- **D1 (HIGH)** `REVOKE EXECUTE ON reserve_analysis_quota FROM anon, authenticated, public; GRANT TO service_role` — live grantees confirmed `…anon,…PUBLIC`; lone anon-callable SECURITY DEFINER inserter.
- **D2 (MED-perf)** wrap `auth.uid()`→`(select auth.uid())` on `kg_entities`, `kg_relations`, `analysis_chunks` RLS.
- **P4 (MED)** delete the dead `content_text`/`metadata_payload` chunk write (`SupabasePersistenceAdapter.ts:159-176`) — live `analysis_chunks` has neither column. (DB-schema-aligned, lives here.)
- **D5/D7/D4** `VALIDATE` users FK; add covering index on `kg_relations.target_entity_id`; decide `health_ledger` public-read.
- **DEPENDABOT (rides here — security, 2 override lines):**
  - **undici ×10 alerts** → all from root `overrides.undici: "6.21.2"` (web/package.json transitive). Bump override to the latest patched **6.x** that clears GHSA WebSocket DoS / 64-bit-length / fragment-bypass / permessage-deflate / CRLF / smuggling / Set-Cookie items (verify each advisory's patched range; likely ≥ 6.22.x). One-line change clears 10/11.
  - **ajv ×1** → root `overrides.ajv: "6.12.6"` (pinned in PR #98 to fix eslint crash) re-introduces ReDoS `<6.14.0`. Decide: bump to 6.14.0 if eslint tolerates, else document as accepted (ReDoS reachable only via `$data`, unused).
- **Effort**: S-M · **Blocker**: D1 + undici. **Diff**: ~1 migration + ~3 config lines + 1 small adapter edit.

### ▶ PR-2 — WORKER CORRECTNESS + FABRICATED-GREENS GATE  *(make the gates real)*
Cluster W + Cluster G together — the worker fixes and the gate that proves them.
- **W1** delete orphan disconnect block `analysis.ts:420-453` (kills prod `ReferenceError`; `atomic-persist.ts` already owns disconnect).
- **W2** widen `PersistOptions.status` to include `'failed'`; pass `persistController` (not bare signal) into `buildStreamResponse`.
- **W3/W4** `MetadataScraper.ts:58,59,106` typing + `data.items[0]` guard; `user-agent.ts:15` `?? [0]`.
- **W5 (HIGH-sec)** remove `dev-hmac-secret-123` (`chat-stream.ts:239-241`).
- **W6 (HIGH-sec)** strip HMAC debug-leak (`analysis.ts:391-409`, `chat-stream.ts:261-275`) → unconditional `{error:"Invalid token"}`.
- **W7** add `worker/tsconfig.typecheck.json` + `typecheck` script + **blocking CI step** in `ci-cd.yml` (PR) and `deploy-worker.yml` (pre-deploy). 12 real errors → 0.
- **W8** `LLMCascade` total `120000→50000` (fit ~58s CF budget) + reconcile CLAUDE.md Law #2 (15s/50s).
- **Cluster G — qa-intel false-green permanent fix** (see assessment doc): `exit(1)` on ts-morph fail; **treat `high` as blocking**; explicit `--ci`; surface per-rule errors (fail run on rule throw); fix dead rule `streaming.ts:30` (import `TOTAL_DIMENSIONS`, not literal string); delete duplicate `*RuleEngine.ts` modules; scope `fetch-depth:0` to diff jobs; reconcile ledger rule count 40→42.
- **Effort**: M · **Blocker**: ▶ all of W1/W2/W5/W6/W7 + G exit-codes. **Diff**: worker src + 2 workflow yml + engine.

### ▶ PR-3 — PERSISTENCE LIFECYCLE (data recovery)  *(merge-blocker; recovers 52% stuck)*
Cluster P behavioral fixes only (defer pure refactors).
- **P1** self-finalizing stitch via single-winner conditional `UPDATE … WHERE billing_status<>'completed'`.
- **P2** QStash reaper (`/api/webhooks/reaper`, HMAC-verified, ~10min) + shared `finalizeAnalysis(id)` helper → recovers the live 36 + future; unrecoverable → `failed`. (ADR 007.)
- **P3** reorder KG before completion + remove `.catch` swallow (`SupabasePersistenceAdapter.ts:119-157`).
- **P7** one-off backfill for legacy `chunk_index 6-11` (stitch over union of indices, else `failed`).
- **SSOT Layer-0 consolidation (rides here)**: move scattered timeout/limit literals into `config/timeouts.ts`/`limits.ts`/`cache.ts`; persistence already imports `synthesis.ts` — extend the pattern; decouple worker's `../../../web/lib/config` reach. End-to-end: every consumer updated in this PR.
- **Effort**: M-L · **Blocker**: ▶ P1/P2/P3. **Diff**: persist route + adapters + new reaper route + cron script + config modules.

### ▶ PR-4 — FRONTEND CORRECTNESS + DESIGN (formatting is launch-blocking)
Cluster F + Design cluster.
- **F1** move `hasHadVideoRef` mutation out of render (`DashboardContainer.tsx:125-127`).
- **F2** restore sync `extractVideoId` early-return in `useEagerVideoMetadata` (teardown-churn regression).
- **F3** remove sync validation from `useInputStore` setter (real INP source).
- **F5/F6/F7** ChatDock store-mutation guard; `LandingThree` canvas dep; signin **307→303**.
- **D-FMT (LAUNCH-BLOCKING — founder: "otherwise the output is useless because it's not readable")**:
  - Analysis output renders as a wall of text — **no paragraph/line spacing, runs together**. Fix the markdown renderer: real paragraph breaks, `line-height`, vertical rhythm, `max-width` (prose measure), list/heading spacing.
  - **Right fly-out dimension panel**: text too big for the control, no L/R/top/bottom padding, no inter-paragraph spacing → apply design-system spacing tokens + correct control-text sizing.
  - Apply consistent control padding + the 8px spacing grid everywhere text/controls render.
- **D-SYS (design-system compliance + founder taste)**:
  - **Radius: REDUCE per founder** — "over-rounding is too much; slightly rounded only." Set radius tokens to near-sharp (e.g. controls 4-6px, cards 8px, **drop full-pill 9999px** except where semantically required). This *overrides* the design-system's 16px/pill spec — make it the new SSOT design token.
  - **Motion**: replace banned bounce `cubic-bezier(0.34,1.56,0.64,1)` (`shell.tsx:80`) → `var(--ease-out-quint)`; add `prefers-reduced-motion` to component animations.
  - **Typography floor**: sidebar nav 13.5px → ≥14px (`shell.tsx:71`); body never <16px.
  - **Focus rings**: explicit 2px accent on `:focus-visible` (all interactive).
  - **Touch targets**: ≥44px (sidebar nav currently borderline).
  - **theme.tsx**: stateful provider vs design-system "stateless adapter" rule — decide: lift theme state to app root (props-in) **or** consciously accept (it's idiomatic app React; the rule is a design-system-kit constraint, not an app law). Recommend: keep provider, document the deviation. Low priority.
- **Effort**: M-L · **Blocker**: D-FMT (readability gates the pilot). **Diff**: components + design tokens + markdown renderer.

### ⏸ DEFERRED POST-LIVE (separate PRs, low-risk-only after stable)
- **PR-5 (Simplification)**: delete dead WorkflowConductor Path methods + schema-only test (≈−350-400 LOC); collapse `SupabasePersistenceAdapter` passthrough (≈−300 LOC); de-dup KG mapping; remove dead 0-byte stubs (`web/route.ts|server.ts|client.ts`); finish DecodoAdapter removal; drop stale `snyk_*.json`. **Deferred**: wide blast radius — don't refactor days before live.
- **PR-6 (SSOT page + user settings)**: `user_settings` table + settings page + the full security-matrix wiring. Post-live feature.

---

## 3. DEPENDABOT TRIAGE (the 11)

| # | Alert | Sev | Source | Fix |
|---|---|---|---|---|
| 50,52,53,56 | undici WebSocket: 64-bit length overflow / invalid `server_max_window_bits` / fragment-count DoS / permessage-deflate unbounded memory | **High** ×4 | `overrides.undici 6.21.2` (web) | bump override to patched 6.x |
| 48,49,51,57 | undici: unbounded decompression chain / request-response smuggling / CRLF via `upgrade` / Set-Cookie header injection | **Mod** ×4 | same | same bump |
| 55,58 | undici: keep-alive response-queue poisoning / SameSite downgrade | **Low** ×2 | same | same bump |
| 59 | ajv ReDoS `$data` | **Mod** | `overrides.ajv 6.12.6` | bump 6.14.0 if eslint OK, else accept (unreachable) |

**10 of 11 are one override line** (undici). All in PR-1.

---

## 4. CLUSTER → PR MAP (coverage guarantee)

| Cluster | PR | Notes |
|---|---|---|
| D — Database | PR-1 | + deps + P4 |
| W — Worker | PR-2 | + W8 timeout |
| G — Fabricated-greens / qa-intel | PR-2 | the permanent fix |
| P — Persistence lifecycle | PR-3 | + SSOT Layer-0 |
| F — Frontend correctness | PR-4 | |
| Design (fmt + system) | PR-4 | D-FMT launch-blocking |
| SSOT schema/Layer-0 | PR-3 (consts) + spec now | page deferred PR-6 |
| Simplification | PR-5 (deferred) | post-live |
| Hygiene (stubs, Decodo, snyk artifacts, doc drift) | PR-5 + PR-1 | doc drift quick in any |

**Merge-blockers (must land pre-live):** D1, undici, W1/W2/W5/W6/W7, G(exit-codes), P1/P2/P3, D-FMT.

---

## 5. SEQUENCING + LIVE-READINESS GATE
1. PR-1 (DB+sec+deps) → green 4-checks → resolve bots → merge.
2. PR-2 (Worker+gates) → **this is where green starts meaning something**.
3. PR-3 (Persistence+reaper) → run reaper, confirm 36→0 stuck.
4. PR-4 (Frontend+Design) → readability + taste.
5. Then DEFER PR-5/6 to post-live.

**Do-not-go-live-until:** anon RPC revoked (D1) · worker `tsc` gate green (W7) · no `dev-hmac-secret-123` (W5) · reaper recovering stuck rows (P2) · qa-intel `exit(1)`/high-blocking (G) · analysis output readable (D-FMT) · undici patched.

*Draft v2.0.0 — report-only. Implementation to proceed on Haiku per founder.*
