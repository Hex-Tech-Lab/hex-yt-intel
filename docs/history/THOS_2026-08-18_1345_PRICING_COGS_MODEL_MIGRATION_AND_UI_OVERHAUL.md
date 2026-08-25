# TECHNICAL HANDOVER SUMMARY — hex-yt-intel: Pricing/COGS Model Overhaul + Pricing UI Build

**Session Date**: 2026-08-17 (evening) through 2026-08-18 (afternoon), ~18hrs across two sessions bridged by a compaction.
**Agents Involved**: Claude Code (Sonnet 5, orchestrator/verifier), ~15 dispatched general-purpose subagents (Sonnet 5, various scoped research/build tasks), Cline (DeepSeek v4 Flash low-effort + Nemotron 3.5 Lightning, MCP config task), LLM Council (13-advisor synthesis, Sonnet 5).
**Project**: hex-yt-intel — solo-founder YouTube video-intelligence SaaS (Next.js/Vercel web + Cloudflare Worker + Supabase + OpenRouter LLM cascade), ~9-day pre-launch runway.
**Session Type**: Pricing strategy research + real cost-model experimentation + production bug fixes + UI build, tightly interleaved.
**Status**: Real COGS reduction path found and partially validated (GPT-OSS-120B viable for most UCIS dimensions with a prompt fix, ~24-28x cheaper than Haiku 4.5). Pricing/founders pages built as reviewable drafts. Full-scope parity batch test still running at time of writing. One real, unfixed SSOT bug found late in session (cascade provider order, 3 disagreeing sources).

---

## Executive Summary

hex-yt-intel needs to lock pricing before a ~9-day runway launch; the real blocker turned out to be an unresolved COGS question (can GPT-OSS-120B replace expensive Haiku 4.5 for the 11-dimension analysis?) rather than a market-positioning question. This session ran a real evidence chain — multiple real API-call test batches, not synthetic — that found: digest generation is *already* on GPT-OSS-120B in production (confirmed via code, not assumption); a prompt-tuning fix (self-verification checklist) took two weak UCIS dimensions from 0-13% pass rate to 87-100%; real cost savings are ~24-28x. Biggest open item right now: a full 8-9-language × 11-dimension parity batch test is mid-flight in a background agent, and a real single-source-of-truth bug was just discovered (cascade provider order lives in 3 disagreeing places) — unfixed, flagged as the top priority for next session.

---

## Technical Environment

- **Stack**: Next.js (App Router) + Vercel, Cloudflare Worker (Hono), Supabase Postgres, Upstash Redis, OpenRouter LLM gateway.
- **Package manager**: pnpm ONLY — `npx`/`npm`/`uvx`-for-npm-packages are all broken/wrong in this WSL2 environment; use `pnpm dlx` for one-off package execution.
- **Design system**: Tailwind + Astryx (`@astryxdesign/core`), NOT shadcn (confirmed dead, deleted).
- **Repo root**: `/home/kellyb_dev/projects/hex-yt-intel`. Branch: `fix/entity-color-taxonomy-mismatch` (per git status at session start — not verified still current, check `git status` on resume).
- **Real credentials note**: `.env.local` variables are NOT auto-loaded into a shell/agent's process environment just because the file exists — must be explicitly `set -a; source .env.local; set +a` before any script that needs them. This tripped up multiple agents this session (see Recurring Patterns below).
- **Real Supabase table names** (guessed wrong initially, corrected): Settings Registry lives in `setting_definitions`/`setting_values`, NOT `settings_registry`.
- **MCP servers**: `.mcp.json` (repo, Claude Code) fixed to `pnpm dlx` for `exa-mcp-server` and `@modelcontextprotocol/server-brave-search`. Global `~/.claude/mcp_config.json` (symlinked into Cline's config path too) contains ~19 servers' plaintext credentials — user explicitly decided to leave broad Cline access as-is (option A) rather than scope it down, real rotation deferred to pre-launch.

---

## Chronological Timeline (reverse chronological — newest first)

### 2026-08-18, ~13:40 — SSOT bug found: cascade provider order lives in 3 places
🔑 **KEY FINDING, UNRESOLVED**: `web/lib/config/cascade.ts`'s fallback constant, the `setting_values` DB registry (`cascade.analysis` key), AND `worker/src/services/LLMCascade.ts`'s own separately-hardcoded provider order (`['anthropic', 'google-vertex', 'amazon-bedrock']`, no Azure) are three independent sources that can disagree. Fixed #1 and #2 today (Vertex→Azure→Anthropic Direct→Bedrock, based on real OpenRouter speed/uptime data user provided); #3 was NOT touched — worker has no DB access per ADR 005, so the real fix is likely "web resolves the registry value and forwards it to the worker via the signed stream payload" (cascade.ts's own code comment hints this is the intended pattern) rather than giving the worker its own DB query. **Real user directive: "we cannot afford this kind of mistake. It has to be an SSOT, all based in Settings Registry."** Logged to `docs/TECH_DEBT_LEDGER.md`.

Real confirmed OpenRouter provider data for Claude Haiku 4.5 (2026-08-18, user-pasted from OpenRouter's own UI):

| Provider | Latency | Throughput | Uptime | $/M in/out |
|---|---|---|---|---|
| Vertex (Europe) | 0.38s | 91 tps | 100.00% | $1.10/$5.50 |
| Vertex (Global) | 0.47s | 77 tps | 99.87% | $1.00/$5.00 |
| Azure | 0.79s | 81 tps | 99.93% | $1.00/$5.00 |
| Anthropic Direct | 0.82s | 64 tps | 99.43% | $1.00/$5.00 |
| Bedrock (Global) | 1.10s | 52 tps | 99.92% | $1.00/$5.00 |

Real Vertex-Europe OpenRouter provider slug (confirmed by user): `google-vertex/europe`. **User's final, explicit directive: make Vertex Europe the top priority provider, keep the rest of the order as-is (Azure → Anthropic Direct → Bedrock).** NOT YET APPLIED to any of the 3 config locations — top priority for next session, alongside the SSOT consolidation itself.

### 2026-08-18, ~13:10–13:35 — Full 8-9×11-dimension parity batch test dispatched, in progress
User's real, detailed plan (his own words, preserved near-verbatim per session-bridge rule below) — one batch of 8-9 videos across 8 languages (English, Arabic, Belarusian/Russian, Hebrew, Japanese, German, French, Chinese — French/Chinese specifically chosen because they scored lowest, 72/100, in the earlier multilingual test), 10-30min videos (~20min target), testing ALL 11 UCIS dimensions + digest, GPT-OSS-120B vs Haiku 4.5, iterating prompts toward maximum parity (not byte-identical, but matching structure/coverage/quality), including a `reasoning_effort: low` experiment on GPT-OSS-120B (confirmed via user: GPT-OSS-120B is a real reasoning model; Haiku 4.5 is NOT a reasoning model — only Sonnet/Opus have extended thinking).

Real, honest process note: the FIRST two dispatch attempts at this correctly stopped and asked for confirmation/reduced-scope rather than fabricate a 150+-call result under time pressure — this is the desired behavior per the project's standing "never fabricate, report gaps honestly" rule, not a failure. User explicitly re-confirmed "go for full" and "please do" both times. **As of this doc's writing, the third dispatch (agentId `a83633da8a8823ac8`) is still running** — check `docs/research/2026-08-18-full-dimension-parity-batch-test.md` and `docs/research/2026-08-18-parity-batch-results.json` on resume; if absent/incomplete, resume that agent or redispatch with the same real constraints (see "no-async" pattern below).

Real, important user clarification captured mid-session (long verbatim message, condensed here but preserving the actual reasoning): tier differentiation (Free/Light/Pro/Max) is about **feature EXPOSURE and VOLUME**, never about which underlying model computes it — "since when did I ever mention I'm going to be using a different model... The offering is not about the complexity of the refinement of the model itself, but about what is being exposed." Model choice CAN differ per-tier internally for cost reasons (a legitimate secret-sauce optimization), but this must NEVER be marketed or promised to users as a tier feature. This directly corrected an earlier session framing error (conflating "Light secretly runs full compute" with "Light uses a cheaper model") — now recorded correctly in the master pricing doc §6m.

### 2026-08-18, ~11:26–13:00 — Real pricing/founders page UI build (multiple rounds of user-reviewed fixes)
Built from a stale placeholder (old Free/Pro/Enterprise $0/$9/$99 structure) to the real Free/Light/Pro/Max structure. Real iterative fix rounds, each confirmed by the user from live screenshots:
1. Checkmark centering, FAQ Astryx-consistency, single-highlight bug (was showing 2 tiers emphasized at once), motion (reused existing `whileHover={{y:-4}}` pattern from `landing-page.tsx`, NOT invented), tooltips per feature row, CTA button vertical alignment (flex + `marginTop:auto`), monthly/yearly toggle, removed an over-explanatory disclosure paragraph (user: "you're excusing yourself for something you never promised... be specific, clear, and brief without apologizing or over-explaining"), fixed a nonsensical tagline ("Pay for what you use" → doesn't describe a quota-based subscription model), fixed stale comparison table (removed API-access row, not offered yet).
2. Column-hover highlight added to the comparison table (spreadsheet-style, whole column lights up), then the same highlight added to the pricing cards themselves.
3. **Real content-logic bug user caught**: Free tier showed "Executive Digest + Apex Intelligence: false" in the comparison table while its own card promised "full-quality single analysis" — a genuine contradiction (a free user would get no actual insight to evaluate the product). **Fixed**: Free now includes the same focused-view content as Light (Digest + Apex + WordCloud), differentiated from Light ONLY by volume, not depth. Tier ladder is now internally coherent: Free/Light = volume axis, Light/Pro = depth axis (11-dim breakdown + MindMap/Canvas gated to Light+/Pro+ respectively).
4. WordCloud specifically moved into Free tier (was previously bundled into a Light-exclusive "Full Knowledge Graph" line) — split into "WordCloud" (free+) vs "MindMap + Knowledge Graph Canvas" (Light+).
5. `/founders` page built as a separate draft (real content sourced from the master doc, $49/$99 illustrative Founder Light/Pro numbers, linked from `/waitlist`), explicitly NOT merged into the main `/pricing` grid (different intent: scarcity/runway framing vs. steady-state browsing).

Real files touched: `web/app/pricing/page.tsx`, `web/components/billing/pricing-table-client.tsx`, `web/components/marketing/PricingComparisonTable.tsx`, `web/components/marketing/FaqAccordion.tsx`, `web/app/founders/page.tsx` (new), `web/components/billing/founders-table-client.tsx` (new), `web/app/waitlist/page.tsx`, `web/app/admin/parity-review/page.tsx` + `ParityReviewClient.tsx` + `web/app/api/admin/parity-review/route.ts` (new — internal side-by-side Haiku-vs-GPT-OSS review tool, wired to auto-load `docs/research/2026-08-18-parity-batch-results.json` once it exists, currently shows a clearly-labeled MOCK badge).

All pages remain explicit DRAFTS — prices marked "candidate, not final," pending the LLM Council pricing session that has NOT yet been run (precursor research is done, see below).

### 2026-08-18, ~10:00–11:22 — Real n=15 Dimension 1/7/8 fidelity test (the load-bearing evidence)
💡 **BREAKTHROUGH**: real, statistically meaningful test (n=15 videos, 6 languages: English×8, Arabic×3, German, Hebrew, Belarusian, Dutch — one Japanese candidate discarded for being too short, honestly reported not silently substituted) found:
- **Dimension 1** (Apex Intelligence): the earlier n=6 test's "missing 10.4 subsection" finding was itself a bug (a judge artifact — Dimension 10 only has 10.1-10.3, no 10.4 exists in the real prompt spec). Corrected: D1 is 15/15 (100%), no fix needed.
- **Dimension 7** (Implementation Systems): turned out WORSE than initially thought — only 13% pass rate at n=15 (not just a "thin content" edge case as the n=6 subset suggested), affecting 13/15 videos across all languages/domains.
- **Dimension 8** (Knowledge Graph): 87% pass at n=15 (down from a misleadingly clean 100% on the n=6 subset), CI [62%, 96%] — residual gap is narrow (one specific subsection, only on thin/short-form content).
- 🔑 **KEY DECISION / technique that fixed both D7 and D8**: appending a self-verification checklist instruction to the prompt ("silently confirm all required subsections are present before emitting output") took D7 from 13%→100% and D8's earlier n=6 test from 0%→100%. This is the SAME technique that fixed the Executive Digest prompt in an earlier session (mentioned as precedent: "it took 5-6 turns before the digest summary worked perfectly").
- Real cost at n=15, 107 real generation calls: GPT-OSS-120B $0.0475 vs Haiku 4.5 $1.3559 — **~28.5x cheaper**. Zero truncation, zero judge parse errors.
- Both fixes remain EXPERIMENTAL, not shipped to production. Recommendation if promoted: ship D7+D8 together (same technique).
- **Real, honest tangent finding**: the n=6 test's judge had a generic-heuristic bug (a standing risk for any other judge-scored test in this repo reusing that pattern — worth a real audit before trusting other judge-scored numbers blindly, not yet done).

### 2026-08-18, ~09:35–10:00 — Digest token-cap empirical study (real methodology precedent-setter)
🔑 **KEY DECISION, standing rule created**: user rejected an earlier "padded guess" cap (6000 tokens, based on only 4 samples) as arbitrary — **"arbitrary figures are the mother of all fuckups... never have any setting without scientific/empirical backing."** Real study run: n=24 historical GPT-OSS-120B digest rows, real input sizes 3.9K-62K chars, all regenerated uncapped to get real completion-token counts. Real finding: digest length is INPUT-INDEPENDENT (Pearson r=0.13 — always ~4 fixed sections regardless of source length), so a flat cap (not a sliding scale) is the only relationship the real data supports. Empirical max observed: 2471 tokens. Final cap: **3000** (2471 × 1.18 margin), replacing the rejected 6000 guess — applied live to the `digest.maxOutputTokens` Settings Registry key, derivation documented inline in the migration comment per the new standing rule (now `AGENTS.md` §5.0.3 item 6: "No setting without empirical backing").

This methodology directly traces back to a REAL PRODUCTION BUG found the same session: `web/lib/adapters/OpenRouterCompletionAdapter.ts`'s `DEFAULT_MAX_TOKENS = 2000` was hardcoded (violating the existing "no magic numbers" rule) and never overridden by digest generation, silently truncating 5/14 GPT-OSS-120B digest calls (`finish_reason: "length"`) in an earlier fidelity test — this was the trigger for the whole empirical-study exercise.

### 2026-08-18, ~02:37–09:35 — Overnight: digest cascade RCA, fresh-Haiku fidelity test, sleep break
Two real architecture questions resolved via direct code+data verification (not assumption):
1. **Does the digest have its own cascade?** No — it was silently sharing `cascade.chat` (Cerebras-primary, tuned for chat speed) via `resolveChatCascade()`. Real bug, fixed: new `cascade.digest` Settings Registry key created (Groq-primary, Cerebras-fallback, Baseten-third — per real user directive: digest doesn't need chat's latency priority, Groq is cheaper), both digest routes rewired.
2. **What does the digest actually consume as input?** Confirmed via code trace + real row inspection: the full 11-dimension UCIS markdown (`=== DIMENSION 1 – APEX INTELLIGENCE ===` etc.), NOT the raw transcript. This part of "what we knew" was actually correct.
3. **Fresh Haiku baseline test** (n=14, real production system prompt from Vault): GPT-OSS-120B scored 78.9/100 mean fidelity, all 14/14 passed, Wilson CI [78.5%, 100%]. Cost: GPT-OSS-120B ~4x cheaper than Haiku for digest specifically. This REPLACED an earlier, wrong n=6 test whose "Haiku baseline" rows were later discovered (via a real cross-check, including an attempted-but-inconclusive OpenRouter generation-log lookup — daily-aggregated, no per-request granularity, most target dates outside the 30-day retention window) to ALL be mislabeled GPT-OSS-120B rows, not real Haiku baselines — corrected via a banner on the original report, original content preserved not deleted.

💡 **BREAKTHROUGH**: production digest generation was discovered to ALREADY be running on GPT-OSS-120B (via `resolveChatCascade()`'s primary entry), contradicting every prior assumption in this project's history (including CLAUDE.md's own ADR ledger) that digest used Haiku 4.5. This single correction reframed the entire session's cost-model work.

### 2026-08-17, evening — LLM Council pricing session, competitor MoR research, security incidents
- **LLM Council Wave 1** ran successfully (13 advisors + peer review + Monte Carlo + Chairman synthesis) on the pricing/packaging framed question. Real verdict: ship Light secretly computing full UCIS now (option b, zero new engineering against the tight runway) PAIRED with a one-line public disclosure — this "middle path" was only surfaced via anonymized peer review, no single advisor proposed it alone. Statistician: P(Success) 64%, P(Major Failure) 11%, founder pre-sale 90% CI $4.8K-$48K (median ~$14.2K). 8/13 favored ship-now-disclose. Files: `docs/private/council/2026-08-17_pricing_wave1_council-report.html` (+transcript.md).
  - **NOTE**: this verdict's "compute-depth" framing was later corrected by the user (see 2026-08-18 entry above) — the real tier differentiator is exposure/volume, not compute. Re-read the Council transcript with that correction in mind if consulting it again.
- **Real MoR (payment provider) research**: Paddle (primary, confirmed real approval-risk — 3-months-processing-history requirement, a UAE solo-founder-no-entity Reddit precedent found rejected by Paddle then approved by Dodo), Dodo (fallback, real fund-hold complaints but responsive support), Creem (weakest trust signal — a real Trustpilot allegation of $20k withheld funds), Whop researched and REJECTED (misleading headline fee — real effective rate 5.7-6.2% not 2.7%, wrong product shape for API-billed SaaS). EU-based MoR search (Vatly, FastSpring) found nothing better than the existing shortlist.
- 🔑 **Real security incidents, all resolved**: Cline printed 5 live API keys in plaintext across 2 messages (never repeat — confirm presence via `grep -c`, never echo values); a first MCP-config attempt invented fake package names (`mcp__plugin_exa_exa` — confused Claude Code's internal tool-namespace strings for real npm packages) and used `uvx` (PyPI-only) for npm packages; corrected to `pnpm dlx` + real verified package names + env-var key references. User's explicit decision: leave the broad `~/.cline/mcp_config.json` symlink (19 servers' credentials, including a GitHub PAT) as-is for now — key rotation deferred to pre-launch, not urgent.

---

## Recurring Patterns / Housekeeping

### Pattern: dispatched agents ending their turn on "async work, will report later"
**Frequency**: 5+ times in one session, across different agents and different async mechanisms (sub-agent delegation, `run_in_background` Bash, Monitor-watched tasks).
**Core issue**: the platform marks an agent's turn "completed" the moment it stops issuing tool calls, regardless of unfinished background work — nothing automatically resumes it; a human/orchestrator has to notice and manually resend.
**User's implicit frustration**: repeated real time lost to agents that "sound done" but aren't.
**Fix that worked**: explicit instruction to NEVER background/delegate, do all API calls synchronously/foreground across many of the agent's own turns. Now a permanent rule: `AGENTS.md` §5.0.3 item 7.
**Status**: RESOLVED as a documented rule; still worth reinforcing in every future long-running-test dispatch prompt.

### Pattern: agents correctly refusing to fabricate results under real scope pressure
**Frequency**: happened 2-3 times (the parity batch test especially).
**This is NOT a bug** — it's the desired behavior per this project's standing "never fabricate, report gaps honestly" rule. The correct response each time was to explicitly re-confirm "yes, continue with full real scope, take as many turns as needed" — not to accept a truncated/padded result.

### Pattern: `.env.local` presence ≠ loaded into an agent's process environment
**Frequency**: 2+ agents wrongly reported "no API key found" before this was diagnosed.
**Fix**: `set -a; source .env.local; set +a` before any script needing those vars. Documented `AGENTS.md` §5.0.3 item 5.

---

## Current State Snapshot

**What works ✅**:
- Real, validated GPT-OSS-120B viability for Digest (78.9/100 @ n=14, 4x cheaper), D1 (100% @ n=15), D7 (100% @ n=15, WITH experimental checklist fix), D8 (87% @ n=15, WITH the same fix) — 8 UCIS dimensions still untested.
- `cascade.digest` Settings Registry key exists and is wired (Groq-primary).
- `digest.maxOutputTokens` empirically set to 3000, real derivation documented.
- Pricing page, founders page, and internal parity-review admin tool all built, type-checked, and (mostly) visually verified.

**What doesn't work ❌ / is broken**:
- Cascade provider order SSOT violation (3 disagreeing sources) — real, unfixed, HIGH PRIORITY.
- `analyses.duration_seconds` is a dead/NULL column across all 210 rows — logged, not fixed.
- No dedicated video-length-distribution study exists on disk despite user's memory of one — real discrepancy, unresolved (proceed with real DB-derived numbers instead, per the last thing said to the parity-batch agent).

**In-progress**:
- Full 8-9-language × 11-dimension parity batch test (agentId `a83633da8a8823ac8`), explicitly re-confirmed to run at full scope. Check `docs/research/2026-08-18-full-dimension-parity-batch-test.md` and `docs/research/2026-08-18-parity-batch-results.json` for real completion state on resume.

**Blocked**: nothing currently hard-blocked; the parity test and the SSOT fix are both real, actionable next steps, not blocked on external input.

**Technical debt** (see `docs/TECH_DEBT_LEDGER.md` for full entries): cascade SSOT (critical), dead `duration_seconds` column (medium).

---

## Context Preservation — user working style

- **Verify, don't trust self-reports** — applies to every agent including Claude Code's own prior turns. Real DB queries, real code reads, real API responses only.
- **Never fabricate under scope pressure** — explicitly praised when agents stopped rather than pad/truncate silently.
- **No arbitrary numeric settings** — every cap/threshold needs real empirical backing with the derivation documented inline, not just moved to a registry key.
- **Flag before acting** on scope-changing or content-decision items (pricing numbers, refund policy, security exposure) — user wants to make the call, not have it made for him.
- **Terse status-table format** preferred for anything covering 3+ items.
- **Real citations required** for any competitor/market claim — multi-engine research (Exa + Brave minimum), never single-source.
- **Product philosophy, stated directly this session**: tiers differ by exposure + volume, never by promising/advertising a specific model — model choice is an internal cost lever, not a customer-facing feature.
- **Multi-agent delegation model**: this session leaned heavily on parallel background Agent dispatches for real, expensive (dollars-spending) empirical tests — user explicitly comfortable with real API spend ("a few dollars, that's fine") in service of getting real evidence rather than assumptions.

---

## Session Bridge Content (last 3-4 exchanges, preserved near-verbatim)

**User** (paste of real OpenRouter provider data for Haiku 4.5, then): *"no anthropic direct is 4th. its slower than bedrock."* — flagged by the assistant as contradicted by the real pasted numbers (Anthropic Direct is faster than Bedrock on both latency and throughput in the data provided); assistant asked for clarification on whether speed or uptime should govern, and separately noted Vertex Europe beats every listed option.

**User**: *"google-vertex/europe"* (providing the real slug) — then: *"So where is the single source of truth? That's a big mistake. We cannot afford the sound of mistakes. It has to be an SSOT. and all based in settings registry."* — real, direct critique of the just-discovered 3-source cascade-config problem. NOT YET FIXED.

**User**: requested this exact handover document, with a very detailed 20-section template specification (verification philosophy, anti-pattern warnings against over-summarizing iterative cycles/troubleshooting loops/key decisions, session-bridge preservation rule, etc.) — this document is the direct response to that request.

**Immediately prior**: a usage-limit checkpoint fired mid-work, requiring the assistant to finish its current step and give a 3-bullet summary rather than continue open-ended — this handover doc and the checkpoint bullets below are that wrap-up.

---

## Critical Path Forward (next 3 priorities)

1. **Fix the cascade SSOT** — make `worker/src/services/LLMCascade.ts` consume the same `cascade.analysis`/`cascade.digest` Settings Registry values as the web app (likely via the web app resolving and forwarding through the signed stream payload, not a direct worker DB query, per ADR 005's no-DB-access-from-worker constraint). Apply the corrected provider order (Vertex Europe top, then Azure, Anthropic Direct, Bedrock — real slug `google-vertex/europe`) to all three current locations as part of this fix, not as a separate patch. Verification: confirm live behavior via real OpenRouter request logs, not just config inspection.
2. **Resolve/collect the full parity batch test** (agentId `a83633da8a8823ac8` or its successor) — check real completion state, resume if still running, verify the resulting `docs/research/2026-08-18-parity-batch-results.json` matches what `web/app/api/admin/parity-review/route.ts` expects, and manually review a sample via the built `/admin/parity-review` page.
3. **Run the actual LLM Council pricing session** — all real precursor evidence now exists (competitor comparison table, real COGS reduction data, working draft pages) — this was the original goal before the COGS-investigation detour; re-verify the framed question against the corrected exposure/volume tier framing before dispatching.

---

## Reference Index

- Master pricing doc: `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` (§6m and subsections hold all real COGS findings)
- Tech debt: `docs/TECH_DEBT_LEDGER.md`
- Agent roster/protocol/standing rules: `AGENTS.md` §5.0.1–5.0.3 (all incident-driven rules from this session live here)
- Real research reports (all `docs/research/2026-08-1[7-8]-*.md`): multilingual accuracy, digest fidelity (corrected), 3-tier pipeline test, digest cascade RCA, digest token-cap study, Dimension 8/n=15 test, full-UCIS live-transcript test, competitor comparison table.
- Council output: `docs/private/council/2026-08-17_pricing_wave1_council-*`
- Pricing/founders UI: `web/app/pricing/`, `web/app/founders/`, `web/components/billing/`, `web/components/marketing/PricingComparisonTable.tsx`
- Internal review tool: `web/app/admin/parity-review/`
- Cascade config: `web/lib/config/cascade.ts`, `worker/src/services/LLMCascade.ts`, DB table `setting_values` key `cascade.analysis`/`cascade.digest`
