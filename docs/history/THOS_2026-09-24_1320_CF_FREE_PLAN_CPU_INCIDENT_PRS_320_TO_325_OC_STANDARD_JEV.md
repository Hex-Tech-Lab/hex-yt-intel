# THOS 2026-09-24 13:20 EEST — Cloudflare Free-plan CPU incident, PRs #320–#325, OC model standard, Jev

**RESUME HERE** for anything after 2026-09-24 13:20. Covers the session that started 2026-09-19 (post-WSL-crash restore) through today. `main` is still `313a4c51`; **nothing was merged** — every PR below waits for the user's review (standing rule: never merge before the user reviews).

---

## 1. Open PRs (all pushed, none merged)

| PR | Branch | What | State |
|---|---|---|---|
| #320 | `fix/chapter-persist-non-2xx` | Middleware 401'd every worker chapter-persist POST since PR #206 (2026-08-06); persist once per analysis; Sentry on non-2xx. Round 2: testable gate, route HMAC boundary tests. | Gates ✅ (tsc, vitest 1744, worker typecheck, qa-intel diff+full). DeepSource web+worker failing — not yet triaged. |
| #321 | `fix/observability-blind-spots` | CF log fetcher had no datetime filter (always 0 entries); adds Workers Observability events (`exceededCpu`), µs→ms fix, honest partial-result message. Round 2: outcome-event OR filter, timeout, truncation flag, Zod shape, log-injection sanitizing. | Gates ✅; **live-verified** against CF for the incident window (8 `exceededCpu` lines). DeepSource web failing. |
| #322 | `feat/stance-dual-persistence-wordcloud` | AGY's 09-21 work (was uncommitted on the shared checkout): stance relations Redis→Supabase read-through (ADR **031**, renumbered from a colliding 028), backfill script (**already run in prod, 79 rows**), WordCloud active during analysis, OpenRouter X-Title rebrand. Round 2: atomic `merge_analysis_payload_key` RPC, valid-empty persistence, backfill hardening, jsonrepair. **CC fix `c230345c`: RPC allowlisted to `stance_relations`** (was: any authenticated user could overwrite any payload key of their own analyses). | Gates ✅. **Contains a migration that auto-applies to prod on merge (ADR 013).** CodeFactor + DeepSource failing. |
| #323 | `docs/research-e2e-pipeline-map` | AGY (Flash) end-to-end pipeline map — STEP 1 of 3 for ADR 032. | Docs only. |
| #324 | `chore/restore-claude-files-and-crg-mcp` | Restored `.claude/*` after WSL crash; code-review-graph MCP re-wired + pinned `@2.3.9`; checklist/roster reconciliation (§10.1–10.9); prompt banners; **OC model standard** (§4); this THOS. | Docs/config. |
| #325 | `fix/tier-vocabulary-runtime-path` | Tier unification STEP 1: `UserTier` = free/light/pro/max/enterprise; one price→tier resolver; unknown price fails closed; round 2 removed a forged-`planTier` fallback. | Gates ✅. **External review found 8 P1s** → `docs/reviews/2026-09-24-pr325-external-review.md` — next action is an OC round-3 dispatch from that file. |

External reviews for #320/#321/#322/#324 were all addressed in round 2 (except DeepSource/CodeFactor triage).

## 2. Incident: analyses failing ("Stream ended without a terminal signal")

- **Root cause (proven from Cloudflare logs):** worker requests killed with `exceededCpu` — **Cloudflare Workers Free plan 10 ms CPU/request**. The user is on free plans for the entire infra; upgrading is not an option.
- **Why now:** worker CPU per stream has been 370–876 ms for a month and succeeded; on 2026-09-23 CF started enforcing strictly (requests killed at exactly 10.0 ms). No code change on our side caused it (only worker change since 08-28 was logging-only #313).
- **Fix direction (user-approved, ADR 032 to write):** Option A from AGY's map — worker becomes a near-zero-CPU pass-through (verify token, pipe OpenRouter bytes to browser, keep raw copy), browser is the single live parser, Vercel `/persist` parses/validates/stitches the raw text, transcript/metadata/chapters/prompt move to Vercel's prepare step once per analysis. Long stream stays on Cloudflare (Vercel couldn't hold it — the original reason for the move). Persistence must never depend on the browser.
- **Scope decided with the user:** use this to split the two monoliths iteratively (first cut now, rest in later waves): `web/app/api/analyses/persist/route.ts` (~1,507 LOC) and `worker/src/routes/analysis.ts` (~1,261 LOC). Fix on-path tangents (3 s cancel poll, quadratic comment slicing, repeated chapter regex, hardcoded `REAP_GRACE_MINUTES = 30`).
- **Verified facts for the ADR:** reaper works (both broken analyses auto-moved to `failed`, `ac7d0fa6` is `failed/partial` → remediation-eligible). Vercel Hobby `maxDuration` 300 s **only with Fluid Compute** (legacy non-Fluid = 60 s) — **check this project's Fluid Compute setting first.** AGY's CPU inventory omitted transcript fetch/YouTube HTML parsing — must be measured.
- **Build agent:** AGY on Claude Sonnet 4.6 → fallback Gemini 3.1 Pro (quota runs out fast) → never Flash. CC reviews every phase. Plan waves: 0 verify/merge prerequisites → 1 ADR 032 (user approval) → 2a–2f build → 3 prove on real videos (3 min / 28 min / 1 h / 1.5 h Arabic / 3 h), zero `exceededCpu`. Keep an old/new path switch in the Settings Registry until wave 3 passes.

## 3. Other things done
- Worker had **no Upstash Redis secrets** (no cache, no cancel polling, no prompt config) → set via CF API 2026-09-23 21:36 UTC.
- `web/.env.local`: `CLOUDFLARE_API_TOKEN` (cfat_… account token, analytics+observability read) and `CLOUDFLARE_ACCOUNT_ID` added. Vercel prod already had both (57 d old, not replaced). **User should rotate the `cfut_…` token pasted in chat.** Sentry token returns 401 — user to rotate.
- Status line rebuilt (`~/.claude/statusline.sh`, 3 rows, cache-cold warnings).
- Upstash Vector: index is healthy (50 vectors, 5,035/5,035 polls ok); the user's zero-activity dashboard was a different index. Real gap = 50 vectors vs ~115 completed analyses (§10.9). pgvector effectively unused (1/239 rows).

## 4. OC model standard (user directive, committed `34dcaf03` + `4d6dd88a`)
GLM-5.3-flash, OpenRouter provider **CoreWeave only**, `allow_fallbacks: false`, `reasoning_effort: "low"` ("none" is rejected by the endpoint; "minimal" not adopted). Global `~/.config/opencode/opencode.json` and committed `.opencode/opencode.json` are identical. **`main` still has the old Relace config until #324 merges — copy the new config into any worktree before dispatching.** Documented in CLAUDE.md "OC model standard". Rate limit overnight was upstream CoreWeave capacity, not the user's key; second keys don't add capacity; user rejected a fallback provider to keep caching on one provider (explicit `provider.order` disables sticky routing, so no alternation happens anyway). `~/projects/web-agy1-worktree` has its own `.opencode` — not aligned.

## 5. Agent jobs
| Job | State |
|---|---|
| A worker CPU (`fix/worker-free-plan-cpu`) | **Done, local only**: `7d727e3a` BracketBuffer scanIndex fix + CPU bench harnesses, `be68ff8e` ledger. Not reviewed, not pushed. Feeds ADR 032. |
| D Upstash Vector coverage (`fix/upstash-vector-coverage`) | **Never ran** — overnight run stalled at 01:35 (rate limit), today's delayed relaunch broke on a PATH containing spaces. Re-dispatch (prompt `docs/agent-prompts/2026-09-24-oc-d-vector-coverage.md`, worktree has `RESUME.md`). |
| AGY payments research (`docs/research-hex-expan-payments`) | Report committed `0f4c3bea` (`docs/research/2026-09-24-hex-expan-payments-lessons.md`); AGY may still be finishing. Not reviewed. Reuse hex-expan's multi-provider payment factory/lessons (Egypt constraint) for hex-yt-intel payments. |
| qa-intel | diff + **full** mode ✅ on #320/#321/#322/#325 branches. Now part of CC's standard per-branch gate. |

## 6. Jev (typesafe) — benchmark 2026-09-24
Enabled by the user in OpenRouter (`~typesafe/jev-latest` → `jev-1.13-20260917`, Decisions API `POST /api/alpha/decisions`). ~0.5 s per decision.
- **Dispatch routing (10 cases):** 7/8 sizes correct (one "split 1,500-line route" rated hardest vs expected large, conf 0.60). Both short follow-ups detected as not self-contained (p 0.06 / 0.04) → handle in-session.
- **Review triage (7 real findings):** all 3 must-fix and both rejects correct; the 2 should-fix items were over-rated as must-fix; security flag right on 4/5 (log-injection correctly flagged).
- **Verdict:** reliable enough for routing and "is this self-contained/security" gates; use a ≥0.8 confidence threshold, fall back to CC below it. In Claude Code itself a per-message model router would cost more than it saves (model switch = cache loss); the fit is **agent dispatch** (each OC/AGY run starts fresh anyway) and review-finding triage.
- **Product candidates** (not started, need an ADR): Jev-verified cascade (cheap model drafts each dimension, Jev scores, escalate to Haiku only on low score), comment classification (`worker/src/services/CommentClassifier.ts`), chat grounding gate (ADR 008) + chat escalation (§1d), persona detection, transient-vs-no-captions transcript failures. **Privacy:** transcript/comment text would go to TypeSafe via OpenRouter → sub-processor list before launch.

## 7. Next — the roster, in order (user: "loop with the roster")
1. **OC round 3 on #325** from `docs/reviews/2026-09-24-pr325-external-review.md` (the 8 P1s; Light export decision; Stripe tangent).
2. **Re-dispatch D** (vector coverage) with the new OC config copied in.
3. **Review A** (`7d727e3a`) and the **AGY payments report**; triage DeepSource/CodeFactor on #320/#321/#322.
4. **User reviews and merges** #324 first (it carries the OC config), then #320/#321/#322/#323/#325 one at a time — each later merge needs `main` merged in (ledger conflicts), one push per PR at a time (Netlify free-plan builds collide).
5. **ADR 032** (pass-through worker + monolith split + risk register) → user approval → build waves 2a–2f → wave 3 real-video proof. Check Vercel Fluid Compute first.
6. Tier steps 2 (DB constraint, `chat.turnLimit.light/max` seeds, `user_subscriptions.plan_tier`) and 3 (ADR 027 `pricing.tiers` registry), informed by the hex-expan payments report.
7. **qa-intel housekeeping**: implement rule candidates R1–R11 + SQL-migration scanning gap from `docs/qa-intel/RULESET_LESSONS_LEDGER.md` (2026-09-24 entry; reviews archived in `docs/reviews/`). One rule cluster per OC prompt, positive-fire + negative control each. Standing practice: archive every external review in `docs/reviews/` and mine it into the ledger.
8. Wave A-security items 2–5 (CheckoutButtonProps past SLA), T&C footnote (§5.2), roster live-verification backlog (§10.5).

## 8. Needs the user
- Review/merge the six PRs (none merged).
- Decisions on #325: founder prices → `pro` or own tier; Light/Max interim limits; which Paddle webhook URL is registered; Light full-report export.
- Rotate: `cfut_…` Cloudflare token, Sentry token.
- Whether to align `~/projects/web-agy1-worktree/.opencode`.
- Working-tree leftovers: `crash_output.txt` (safe to delete); many prunable worktrees (`git worktree prune`).
