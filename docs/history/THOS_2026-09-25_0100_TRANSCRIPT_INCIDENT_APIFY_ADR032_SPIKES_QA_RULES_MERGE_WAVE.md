# THOS 2026-09-25 01:00 EEST — Transcript incident (Apify), ADR 032 spikes, qa-intel rules, merge wave

**RESUME HERE** for anything after 2026-09-25 01:00. Previous: `THOS_2026-09-24_1320_...`. Live todo: `.memory/SESSION_TODO.md` (show it every round — user rule). Working style (user rules, in memory): OC does legwork (GLM-5.3-flash low default; Spark 1.3 contributor equal alternative), CC architects/verifies/merges; every report also as an HTML artifact; pnpm only (no npm); never paste secrets into prompts/docs.

---

## 0. First actions next session (in order)
1. **Production transcripts are still broken until PR #336 merges.** It was pushed by OC's qa-fix round (`aa353a6f`) but is DIRTY (behind main) and UNVERIFIED. Do: merge `origin/main` into `.claude/worktrees/apify`, run `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` (exit 0), worker tsc, `vitest ../worker/src/__tests__/ApifyTranscriptProvider.test.ts ../worker/src/__tests__/TranscriptExtractor.test.ts`, scan for conflict markers, push, wait CI, merge (CodeFactor waiver already documented on the PR). Merge auto-deploys the worker (`.github/workflows/deploy-worker.yml`). Then live-test: `POST https://yt-intel.hex-tech-lab.workers.dev/fetch-transcript {"videoId":"dQw4w9WgXcQ"}` and `LTNVA2iP9YU` → expect real text, not the 95-byte placeholder.
2. **#334** (qa Q3 + conflict markers R12) is CLEAN after OC's Q3/Q4 merge (`f10547a2`) — verify the combined file-selection semantics (TS → all TS rules; `supabase/migrations/*.sql` → SQL rules + R12; other text → R12 only) and the new combined test, then merge. Then #335 (Q2): merge main in (conflicts expected in `rules/index.ts`, keep both), test, merge.
3. Verify #331 round (`0dfea5df`, report reconciled with triage) → merge main in (DIRTY) → merge.
4. #327 round 3 finished in 47 s with no new commit — treat as NOT done; re-dispatch (CodeFactor 4 issues) with prompt `docs/agent-prompts/2026-09-24-oc-pr327-review-round3.md`.
5. #325: round 4 done (`6fa2acd5`: webhook unification — legacy URL delegates to canonical handler; Redis lock returns 409 + separate `:done` marker; Sentry; Dodo header). Wait/check bot review, merge main in, merge. **User must confirm which Paddle webhook URL is registered**, then the legacy URL can be deleted.

## 1. Incidents
### 1a. Transcripts (OPEN until #336 is live)
- Symptom: every analysis gets the 95-byte "[Transcript unavailable...]" placeholder (verified live, even dQw4w9WgXcQ).
- Cause: Decodo Web Scraping API free plan exhausted ($1/$1) → HTTP 429 (verified with the key directly). Native YouTube tier is blocked from datacenter IPs. Residential-proxy code path is dead: `worker/src/services/http-utils.ts fetchWithProxy` uses a non-standard `proxy` fetch option Cloudflare ignores (Decodo dashboard shows 0 bytes proxy traffic).
- Fix: PR #336 — `ApifyTranscriptProvider` (actor `johnvc/youtubetranscripts`, `run-sync-get-dataset-items`, ~$0.001/video, Apify free plan $5/mo credit) first in a configurable chain `TRANSCRIPT_PROVIDER_ORDER` default `apify,decodo,native`, 75-language preference list (en/ar first). Live-verified: en 61 segs 7 s, ar 483 segs, 2h13m 2,196 segs 39 s, de auto-only 602 segs. `APIFY_TOKEN` set on CF worker `yt-intel` + Vercel (prod+preview, Sensitive) + `web/.env.local`.
- New option from user: **TranscriptAPI** (`https://transcriptapi.com/api/v2/youtube/transcript?video_url=<id>&format=json`, Bearer key, key name `transapi-expan-prod`) — key saved to `web/.env.local` as `TRANSCRIPTAPI_API_KEY`. Not tested yet. Candidate second provider in the chain (add adapter behind `TranscriptProviderPort`, same pattern as Apify). CF worker env already has `BRIGHT_DATA_TOKEN` too (unused in code).
- Decodo $19 upgrade: on hold (user investigating); not needed if Apify holds.
### 1b. Cloudflare Free-plan CPU kills (from 09-23)
- **User upgraded to Cloudflare Workers Paid (active, renews Oct 9, 2026)** — 30 s default CPU/request, up to 5 min. Production analyses should work again once transcripts are fixed. TODO: set a worker CPU limit (`[limits] cpu_ms` in `worker/wrangler.toml`, e.g. 2000–5000) to cap runaway cost, then run a real end-to-end analysis.
- #330 merged: BracketBuffer O(n²) → O(n) + a deterministic scanned-chars guard (fails on the old algorithm: 1.1e9 vs 1.1e6 bound).

## 2. ADR 032 (accepted, now needs rewrite)
- Registered as accepted (#329). Wave 2a spikes (results in `.claude/worktrees/spike2a*/.scratch/spike-*.md`):
  - S1 PASS: raw SSE is 20–30× text; largest real chunk 22.7 KB text → ≤0.7 MB raw per chunk (Vercel limit 4.5 MB).
  - S2 FAIL: YouTube hard-blocks Vercel datacenter IPs (consent wall / "Sign in to confirm"); also revealed the Decodo incident.
  - S3 FAIL: worker tee+collect+HMAC CPU p50 11 ms (500 KB) / 30 ms (2 MB); crypto only ~2 ms; tee+collect dominates.
  - S4 PASS: Vercel Fluid route (300 s) holds a chunk's LLM stream end to end: max 64.5 s (GLM), 34.5 s (Haiku); survives client disconnect and persists 3/3; client gets every byte 5/5.
- Rewrite direction (not written yet): with Apify for transcripts (no datacenter-IP problem) and S4, the whole analysis can run on Vercel; with Workers Paid active this is now cleanup, not an emergency. Also fold in #329 review: add Alternatives + Confirmed-by-user to `.memory/ADRS.md` entry; say the browser keeps live SSE parsing; fill ADR table gap 025–031 in CLAUDE.md.
- Vercel: Fluid Compute ON, default max duration 300 s, region cdg1, 1 vCPU / 2 GB. Preview env lost its shared `OPENROUTER_API_KEY` during S4 cleanup (it was invalid/401 anyway) — add a valid one if previews must call OpenRouter.

## 3. PRs
Merged this session: #328 (drop unused pgvector; prod migration verified), #324 (restore/config; OC providers), #321, #329 (ADR 032 docs), #320, #326 (site claims copy + refund policy first-purchase-only), #330, #332 (qa Q1 security rules), #333 (qa Q4 SQL rules).
Open: #336 (transcripts, P0), #334 (Q3), #335 (Q2), #325 (billing tier step 1 + round 4), #327 (embed coverage; backfill already applied 119/119), #331 (payments research docs), #322 (stance relations, contains prod migration), #323 (pipeline map docs).
Landing rule: squash with "(#N)"; merge `main` into the next branch before merging it (never rebase/stash); scan for conflict markers before any merge commit; `DeepSource: JavaScript (web)` fails on main too (documented waiver).

## 4. qa-intel
- Rules from the 09-24 lessons ledger: Q1 R1/R2/R5/R10 (merged), Q4 R4/R13 SQL + SQL-migration scanning (merged), Q3 R3/R8/R12 conflict markers (#334), Q2 R6/R7/R9/R11 (#335). Each has positive-fire tests from the real bug and negative controls.
- **True positives live on main (not fixed yet — dispatch one OC task after #334/#335 land):** R1 `web/lib/stripe/webhook-handlers.ts` hardcoded 'pro'; R1 legacy billing webhook + R10 usage-summary (both fixed by #325); R7 ×9 server fetch without timeout (`web/lib/admin-logs/fetchers.ts` ×6, upstash-snapshot-poll ×2, transcript-purge); R8 ×4 log injection (`fetchers.ts:70/75/684/688`); R9 `relations-engine.ts:274`; R11 `relations/route.ts:155` empty-result recompute bug.
- The Q1 agent wrongly reported "0 hits" (grepped rule name, findings print titles) — corrected on #332.

## 5. Billing / product
- Product map + LLM Council + Jev: artifact https://claude.ai/artifact/P7f9v3f1JfEUVfonRHqZQp ; council files `docs/private/council/2026-09-24_1400_*`. Decisions: founder = lump-sum credit pool with expiry, both levels full UCIS, term end → Free + renewal offer, count-or-date cap, Light digest-only export, Free 3/mo, 7-day first-purchase usage-gated refund.
- Blocking finding: at ~$0.34/analysis, Light and Pro lose money at full use → decide COGS/quota/price before founder pricing. Open: founder prices ($49/$99 vs $79/$149), entity + Paddle KYC (pending, not refused; Dodo refused Egypt; fallback Lemon Squeezy → Payhip → FastSpring).
- Entitlement engine TODO: remove unlimited for founder/pro, compound pool + expiry, internal tester role for the user's account + escoseri@gmail.com.
- Payments triage (#331) follow-ups beyond #325: Paddle-live gate, entitlement engine.

## 6. Agents / routing / tooling
- Bake-offs (artifact https://claude.ai/artifact/KhR1Yk6vrYZi7H2cMvQ863): GLM-5.3-flash low ≈ Spark 1.3 contributor; GLM medium no gain; Gemini 3.8 Flash low only for HTML pages.
- OC provider order (committed): CoreWeave → Together → Relace, fallbacks on; global `~/.config/opencode/opencode.json` == repo `.opencode/opencode.json` (copy into every new worktree).
- OC gotchas: never `cd` (auto-rejected), never /tmp, worker tests via `pnpm --filter @hex-yt-intel/web exec vitest run ../worker/src/__tests__/<file>`, `.scratch/` is gitignored, jobs launched via `scratchpad/launch.sh` (45-min timeout); another session (hex-expan) sometimes SIGTERMs all `opencode` processes — relaunch with a RESUME note.
- `/pr-review-workflow` skill rebuilt at `~/.claude/skills/pr-review-workflow/SKILL.md`.
- Vercel: 14 readable secrets converted to Sensitive; `VERCEL_TOKEN` in `web/.env.local`.

## 7. Needs the user
- Rotate (pasted in chat): Cloudflare `cfut_…`, Sentry token, Vercel `vcp_…`, Apify token, **TranscriptAPI key** (`sk_…`, pasted 2026-09-25).
- Confirm registered Paddle webhook URL; Decodo decision; COGS/pricing decision; entity + Paddle KYC.
