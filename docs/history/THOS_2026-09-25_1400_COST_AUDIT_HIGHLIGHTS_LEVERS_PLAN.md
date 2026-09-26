# THOS 2026-09-25 14:00 EEST — Deck cleared, cost audit, 4 cost levers, highlights, plan for 4-day low-budget window

**RESUME HERE.** Previous: `THOS_2026-09-25_0100_...`. Live todo: `.memory/SESSION_TODO.md` (show it every round — user rule). User rules (memory): OC/AGY do the legwork, CC keeps to architecture/orchestration/review; every report also as HTML artifact; pnpm only; never paste secrets into prompts/docs; key rotation deferred until just before production.

**Budget constraint (user, 2026-09-25):** CC quota is nearly exhausted until **Tuesday 2026-09-29**. Next session must run on a very tight token budget: CC = architect/orchestrator/merge only; offload implementation to OC and AGY, and offload **audit/review to AGY running Claude Opus 4.6 or Sonnet 4.6** (`agy --model "Claude Opus 4.6 (Thinking)"` / `"Claude Sonnet 4.6 (Thinking)"`, already paid). CC re-verifies only merge-critical facts.

---

## 0. First actions next session (in order)
1. **Land the 5 open PRs.** Use `scratchpad/merger.sh` (sequential: wait for CI, merge if the pipeline passes, re-merge main if a branch goes DIRTY; waives CodeFactor/Codacy/DeepSource only). Recreate it from §7 if the scratchpad is gone. Suggested order: #345 → #349 → #346 → #347 → #348. Have AGY (Sonnet 4.6) review each diff first (the §3 findings are its checklist). Not yet reviewed by CC:
   - **#345** `fix(history): live background status for History cards` (CLEAN)
   - **#349** `fix(highlights): full-duration windowed harvest + non-overlapping intervals` (CLEAN)
   - **#346** `fix(web): accept real persona/kg fragment shapes; de-weight persona steering (UCIS v5.4)` (UNSTABLE: check which check fails)
   - **#347** `fix(qa-intel): close 6 post-merge #340 rule gaps` (UNSTABLE)
   - **#348** `perf: Anthropic prompt caching for the 5 bundle LLM calls` (UNSTABLE). **After merge, live-verify**: run one analysis, then confirm `analysis_chunks` cost dropped and OpenRouter usage shows cached tokens for bundles 2–5.
2. **AGY business-case round 2** (process may still be running): commit `26131212` + `db983df9` sit on `origin/docs/business-case-cogs-pricing` AFTER #339 merged. Open a new PR from that branch, then dispatch round 3 with the review findings in §4.3 plus the measured numbers in §2, and delete `patch_script.cjs`, `patch_script.js`, `rewrite.py` from main (committed by mistake via #339).
3. Write the ADRs in §5 and dispatch the tracks in §6.

## 1. What happened this session (16 PRs merged)
#337 #331 #336 #338 #323 #335 #340 #334 #339 (mistake: rejected round-1 business case) #327 #341 #342 #343 #344 #325 #322. Production migrations applied by CI: `20260924231500_merge_analysis_payload_key_rpc` (renamed from an out-of-order 20260924120000) and `20260925090000_seed_relations_registry_keys`.
- **Transcripts fixed**: chain `transcriptapi,apify,decodo,native,supadata`. TranscriptAPI live at 0.3–0.5 s (Apify took 7–39 s). Supadata is the last tier: AI mode is fail-closed when duration is unknown, cap `SUPADATA_MAX_AI_MINUTES` (0 disables it), and `/fetch-transcript` forces the cap to 0. CF worker secrets set: `TRANSCRIPTAPI_API_KEY`, `SUPADATA_API_KEY`, `APIFY_TOKEN`. Keys are in `web/.env.local`.
- **TranscriptAPI plan**: 100 free credits on signup (expire after 90 days), then $5/month for 1,000; 1 credit per successful transcript; HTTP 402 when exhausted, which falls through to the next tier.
- **Supadata**: 100 free credits/month; AI mode costs 2 credits per minute; a native miss may cost 1 credit.
- **Vercel**: Git preview deploys disabled (`vercel.json` `git.deploymentEnabled:false`); the free plan's 100 deploys/day were exhausted on 09-24. Production deploys only via `ci-cd.yml`. Red main runs that day were the "Deploy to Vercel" rate limit only, not code.
- **Persist route** (#343) now logs and reports to Sentry the request-schema 400 that used to be silent (`persist: invalid request payload schema`, with fieldErrors). Cause of the 09-24 stuck analysis `6047514f`: 44 silent 400s. The field was never identified; the re-run succeeded.
- **pr-review-workflow skill**: the original V2 (10 KB, "Global Source of Truth") was restored from `~/.gemini/antigravity-cli/skills/pr-review-workflow/SKILL.md` to `~/.claude/skills/...` with repo addenda; the rebuilt copy is backed up as `.rebuilt-2026-09-24.bak`.
- **OpenRouter keys (corrected)**: `sk-or-v1-029…a4b` = **KiloCode dev key** (OC and `web/.env.local`); `sk-or-v1-37d…d99` = **hex-v-intel-prod** (the product). Same account pool. The account went to −$0.16 on 09-24; the user topped it up.
- The OC standard (CoreWeave → Together → Relace, fallbacks on) is already on main in `.opencode/opencode.json` and CLAUDE.md.

## 2. COST AUDIT (measured 2026-09-25, not estimated)
**OpenRouter spend by key (lifetime / September):**
| Key | Lifetime | Sep 2026 |
|---|---|---|
| openrouter-KiloCode-VSCode-API-Key (dev, coding agents) | **$222.55** | $51.95 |
| hex-v-intel-prod (product) | **$14.56** | $4.11 |
| hex-expan-prod | $4.32 | $4.32 |
The ~$250 total account spend is mostly agents and dev, **not product**.

**Per analysis (`analysis_chunks.cost_usd`):**
- All time: 121 completed analyses, 87 with cost rows: **$5.93 total, mean $0.165, median $0.164**. 128 failed analyses; 44 have chunk rows, $0.72 total.
- Earlier measure (41 analyses): mean $0.153, p50 $0.160, p90 $0.187, max $0.206; ~88.4k tokens; 4.6 chunks avg.
- **September (current stack)**: 26 attempted, 16 completed, 20 incurred cost. Chunk cost $3.09. Prod key spend $4.11, so ~$1.02 went to digest/chat/comments/remediation. **All-in: $0.21 per costed attempt, $0.26 per successful analysis.** This matches the user's 22 ¢ benchmark. `usage_logs` Sep shows $4.70, which exceeds actual key spend: likely double counting or estimates, not trustworthy.
- **Anatomy (analysis 434ef182, video f6We53TnkbU, 32 min, Haiku 4.5 via OpenRouter at $1/M in, $5/M out)**: 5 chunks at $0.027 / 0.050 / 0.031 / 0.037 / 0.041 = **$0.187**, ~114k tokens. Solving cost = in·1e-6 + out·5e-6 per chunk gives **input ≈ 19.2k tokens in EVERY chunk** (the identical prompt+transcript package sent 5×) and output 1.6k–6.2k. **Input ≈ $0.096/analysis, output ≈ $0.09.**
- **No prompt caching existed anywhere** (`cache_control`: 0 hits). CC made **no** LLM-cost optimizations this session. Earlier "ran multiple times" fixes were CPU and duplicate requests, not tokens.
- Failure tax: 128 of 249 analyses ever failed; failed attempts still spend.

## 3. Latest findings (verbatim detail — do not lose)
### 3.1 Live run trace, 2026-09-25 12:56 UTC (user's 15:56 local), analysis `434ef182-b889-45c2-b3dc-5bea6c93b86c`, video f6We53TnkbU
- Exactly 5 chunk rows, completed 12:57:12–12:57:48; no duplicate generations. Browser showed 10 `analyze-llm-stream` requests = 5 CORS preflights + 5 POSTs (by design). Vercel persist: 5×200 + 1×202 (final assembly), no 400s. Row `completed`, digest present, knowledgeGraph object present. Total $0.187.
- Old stuck row `6047514f` was set to `failed` only at 12:56:49, **when the new run superseded it**. The reaper (ADR 007) **never swept a zero-chunk `processing` row in ~14 h**. This is the gap #345 addresses (verify #345 fixes the reaper selection, not just the UI).
- Browser console on the same session still showed `[Synthesis] Fragment validation failed` / `[Adapter] Fragment validation failed, skipping` for `persona` (`config.primary.id:'creat…' weight 0.25, tertiary 'consultant'`) and `kg` (`nodes:15, edges:15, rootId:'node_1'`; earlier `rootId:'jev_model'`, 15 nodes/20 edges). Sentry: ~16× "Validation dropped payload at stitch-analysis-chunks (node)" + "stitch-analysis-chunks: dropped dangling edges". Fix = #346 (unmerged).
- YouTube `postMessage` origin warnings = embed noise, harmless.
### 3.2 UX items from the user (not yet dispatched)
- The error banner under the URL bar disappears on its own; the user could not read it. **Make errors persist until dismissed.**
- The button says **"Analyze"** for a video that already has an analysis; it should say **"Re-analyze"**.
- History card must be a live system: reaper, remediation and requeue transitions reflected via hooks/realtime (#345 scope). It must never show stale "processing".
### 3.3 Highlights (user: "the real value of the product" — summarise a 60-min video into 5–10 min accurately)
- Video f6We53TnkbU (32 min): the reel was ~4 min and **covered only the first ~50%** (missed the VPS/hosted setup guide in the second half); **consecutive highlights overlap** (the next starts inside the previous). The user judged the selection "not smart".
- #349 (OC) claims: full-duration windowed harvest + non-overlapping intervals + tests (≥90% span, no overlap), plus a design doc `docs/research/2026-09-25-jev-highlight-ranker.md` (Jev as importance ranker). **Verify the root-cause claim in the PR body against code before merging.**
- **Stinger sound (ADR 030, `docs/private/ADR_030_BROADCAST_STINGER_TRANSITION_2026-08-27.md`)**: the current transition sound is a "bang"; the user wants the industry-standard **swoosh / whoosh** used in professional Arabic broadcast programs: a quick air-swoosh synced with a scene **slide/wipe** (like flipping a page quickly), logo stinger between cuts. Replace the sound asset and make the visual a directional slide/whip-pan wipe timed to the swoosh. Use a licensed/royalty-free asset or synthesise one (filtered noise sweep); record the source/licence in the ADR.
### 3.4 Persona (user decision, 2026-09-25)
Keep persona dimensions as **information**: 3–5 personas with weights plus the "Most Suitable User Profile" (Consultant, Creator, Researcher, Student, PM, Indie maker…). **Never** let persona steer or filter what the analysis includes ("show this to that"). Council verdict / PR #232 removed the picker; `ucis-v5.3.ts` still had persona-weighting lines (15–18, 82–129; Dims 1/2/3/6/9.4). #346 claims UCIS v5.4 de-weights these; verify it kept the indicator output.

## 4. Open review findings to hand to agents
### 4.1 #341/#344 Supadata: fixed and merged in #344 (fail-closed cap, cap 0 disables, no-caption signal, poll deadline, isFinite). Residual: a native miss may cost 1 credit (documented).
### 4.2 #340 rule gaps → #347 (R4 comment-based allowlist + same-arity overloads, R13 schema-qualified/quoted identifiers, R2 computed access, R1 static pricing table negative, scanMode/allFiles).
### 4.3 Business case (#339 + round-2 commits) — external review, all valid
- P1: headline says $9 Light / $15 Pro but the tables model $5/$9; margins exclude the doc's own $0.05 secondary cost. At all-in p90 $0.237: 28 videos = $6.64 at full use; at $9 & 50% use the margin is 63.1% (not the claimed 70.9%); at $15 it's 77.9% at 50% and 55.8% at 100%.
- P1: `scripts/research/run-pricing-research.ts` uses deprecated `perplexity/sonar-reasoning` (use `sonar-reasoning-pro`/`sonar-pro`); fails open (errors → [], missing creds only warn, no HTTP status check). Must fail loudly or mark incomplete.
- P2: founder math: 300 analyses = $71.10 with secondary costs (leaves $7.90 at $79); 600 = $142.20 (leaves $6.80 at $149), before fees/support; no break-even subscriber counts vs ~$89/mo fixed.
- P2: dedupe by URL collapses all Perplexity results (all `https://openrouter.ai`); keep provenance.
- P2: competitor table has no per-row source URLs/access dates; output lives in `.scratch` (not in the PR); the 41-analysis sample is small.
- P3: delete `patch_script.cjs`, `patch_script.js`, `rewrite.py` (on main); unused `re`/`text`/`BRIGHTDATA_TOKEN`.
- **Rebase all numbers on §2.** Product cost is $0.19 clean, $0.21–0.26 all-in today; the targets are in §5.

## 5. PLAN — 4 cost levers + highlights (user approved: "implement them all", create ADRs, dependency-sequenced, tight token budget)
Targets: **~$0.10–0.12 per analysis after L1+L3; ~$0.06–0.08 with L2.**
| # | Lever | ADR | Depends on | Track |
|---|---|---|---|---|
| L1 | **Prompt caching** (shared prefix = UCIS core + transcript; bundles 2–5 wait for bundle 1's first byte; cached-token accounting). Input $0.096 → ~$0.03 | ADR 033 (new): Bundle prompt caching | #348 merged + live-verified | OC (done, PR #348) |
| L3 | **Failure tax**: reaper sweeps zero-chunk rows (#345), persist 400 root field (Sentry), fragment drops (#346) | ADR 007 addendum | #345, #346 | OC |
| L2 | **Jev-verified cascade**: cheap drafter (GPT-OSS/GLM) per dimension → Jev (`~typesafe/jev-latest`, Decisions API `POST /api/alpha/decisions`, ~0.5 s) scores → escalate only low scores to Haiku. Needs a bake-off on 10 real videos: quality delta vs cost | ADR 034 (new): Jev-verified dimension cascade (touches ADR 011 routing) | L1 merged (measure baseline first) | OC implements; AGY (Opus 4.6) designs the bake-off + audits quality |
| L4 | **Light tier = direct transcript→digest path** (no full UCIS compute) | ADR 035 (new): Tiered compute depth | pricing decision (business case round 3) | OC |
| H1 | **Highlights coverage/overlap** | ADR 028 addendum | #349 | OC (done, PR #349) |
| H2 | **Jev highlight ranker** (importance scoring of candidates, target 5–10 min reel for 60 min) | ADR 036 (new), from OC's design doc | H1 | OC implements; AGY audits |
| H3 | **Swoosh stinger**: sound asset + slide/wipe visual synced | ADR 030 addendum | none | AGY on Gemini Flash (UI) |
| U1 | Persistent error banner + "Re-analyze" label | none | none | AGY on Gemini Flash (UI) |
| B1 | Business case round 3 (§4.3 + §2) + delete stray scripts | none | AGY round 2 finished | AGY on Gemini 3.1 Pro |

**Sequence**: (a) land #345 #349 #346 #347 #348 → (b) live-verify L1 savings on 1 analysis → (c) in parallel: B1, H3, U1 (AGY) and ADRs 033–036 written by AGY (Sonnet 4.6) from this THOS → (d) L2 bake-off → L2 implementation → (e) H2 → (f) L4 after the pricing decision.
**Audit**: AGY on Claude Opus 4.6 / Sonnet 4.6 reviews every PR against its prompt and against CLAUDE.md gates; CC only checks CI green + merges.
**Token budget for CC**: ≤ 1 short status per round; no file reading beyond PR titles/check states and the agent final reports; delegate every investigation.

## 6. Agents / tooling
- OC launcher: `scratchpad/launch.sh <worktree> <prompt-file> <log-name>` (45-min timeout). Prompts are built from `docs/agent-prompts/TEMPLATE.md` (§0 lines 22–40 and §5/6 lines 214–225 copied verbatim; hard rules: never `cd`, never /tmp, `.scratch/`, pnpm, no stash/rebase, unpiped exit codes, worker tests via `pnpm --filter @hex-yt-intel/web exec vitest run ../worker/src/__tests__/<file>`). OC cannot read files outside its worktree: inline any referenced prompt text. Two OC launches at the same instant can hit "database is locked": relaunch.
- AGY: `agy -p "<prompt>" --model "<name>" --dangerously-skip-permissions` from inside the worktree. Model names: "Gemini 3.1 Pro (High)", "Gemini 3.8 Flash (Low)", "Claude Opus 4.6 (Thinking)", "Claude Sonnet 4.6 (Thinking)", "GPT-OSS 120B (Medium)". No `--effort` on Pro.
- Merge queue helper `land.sh <worktree>`: merges origin/main, union-resolves `.memory/AGENT_LEDGER.md`, `.memory/SESSION_TODO.md` and `docs/qa-intel/RULESET_LESSONS_LEDGER.md`, fails on real conflicts, scans for markers, pushes. Auto-merge is disabled on the repo.
- Local `supabase db push --dry-run` fails ("Invalid access token format"); use the Supabase MCP `execute_sql` on `supabase_migrations.schema_migrations` instead.
- Sentry org `hex-org` (region de), project `hex-yt-intel`. Vercel team `team_vgnBI2s3ynPBzQdOLqhGvBnK`, project `prj_jKAo3z8jKyHwi3qXqSIeoZO1ILku` (runtime logs: group_by statusCode works; free-text queries over wide windows time out).

## 7. merger.sh (recreate if scratchpad is gone)
Loop over "pr:worktree" items: if DIRTY run land.sh; wait until `gh pr checks` has no pending; if any failing check matches Pipeline Status/Lint/Type/Test/Build/Vercel → BLOCKED; else `gh pr merge <n> --squash`. Note: Vercel failing = the deploy rate limit (block unless waived by hand).

## 8. Needs the user
- A Paddle API key with notification-settings read/write (both current keys return empty `data` though `estimated_total: 2`). CC then registers the canonical webhook and deletes the legacy `/api/billing/webhook`.
- Rotate before production: Cloudflare `cfut_`, Sentry, Vercel `vcp_`, Apify, TranscriptAPI `sk_`, Supadata `sd_` (all pasted in chat).
- Pricing decision after business case round 3; Decodo top-up (keep as tier 3, pay later); entity + Paddle KYC.
- OpenRouter balance was thin (~$8 on 09-25); top up before heavy testing.
