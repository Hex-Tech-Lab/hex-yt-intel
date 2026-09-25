# Live TODO — carried forward from 2026-09-24 (updated every round)

## THOS §7 roster
- [~] 1. PR #325 round 3 — Light digest-only + normalizeUserTier DONE (d95e8ba4); open: annual/founder price→tier (blocked on COGS decision), duplicate Paddle webhook routes, DB CHECK (step 2)
- [x] 2. Job D vector coverage — PR #327, backfill applied (119/119 vectors)
- [x] 3. Job A reviewed (MERGE-READY) → PR #330, lint round running · payments triage done → PR #331 (docs)
- [~] 4. Merge queue — ✅ #328 #324 #321 #329 #320 #326 #330 → landing script: #332 → #333 → #334 → #335 (qa rules) · #336 Apify (merge on green → auto worker deploy → live test) · #325 (round 4 done, waiting bot review) · #327 round 3 + #331 docs round running · then #322, #323
- [~] 5. ADR 032 — S1 PASS (≤0.7 MB/chunk) · S3 FAIL (tee+collect 11–63 ms CPU) · S2 FAIL (YouTube blocks Vercel IPs) · S4 PASS (Vercel per-chunk streaming under Fluid 300 s) → ADR rewrite pending. Revision must also: add Alternatives + Confirmed-by-user to .memory/ADRS.md entry, say browser keeps live SSE parsing, fill ADR table gap 025–031 (#329 review)
- [ ] 6. Tier steps 2–3 (DB constraint, turnLimit seeds, pricing.tiers registry)
- [ ] 7. qa-intel rules R1–R11 + SQL-migration scanning (+ new: DROP FUNCTION with DEFAULT args; committed conflict markers). Archive today's external reviews (#326, #327, #328, #329, #330) in docs/reviews/
- [ ] 8. Wave A-security 2–5, T&C footnote, roster live-verification backlog

## INCIDENT 2026-09-24: prod transcripts = placeholders (Decodo 429, free $1 exhausted) → fix = PR #336 Apify provider (live-verified en/ar/2h13m/de); Decodo + CF $5 on hold
- [ ] Fix qa-rule true positives: R7 ×9 fetch without timeout, R8 ×4 log injection (fetchers.ts), R9 relations-engine, R11 relations route empty-result bug, R1 stripe/webhook-handlers
- [ ] ADR 032 rewrite: all-Vercel (Apify transcripts + Vercel streams/persists per chunk, S4 PASS); CF optional

## Added this session
- [x] Product map + LLM Council + Jev (artifact P7f9v3f1JfEUVfonRHqZQp)
- [x] Model bake-offs 1+2 → GLM low default, Spark contributor equal (artifact KhR1Yk6vrYZi7H2cMvQ863)
- [x] OC providers: CoreWeave → Together → Relace, fallbacks on
- [x] pr-review-workflow skill restored
- [x] Vercel "Needs Attention": 14 readable secrets converted to Sensitive (0 left); VERCEL_TOKEN in web/.env.local
- [ ] Entitlement engine: remove unlimited (founder/pro), compound pool + expiry, internal tester role (user + escoseri@gmail.com)
- [ ] Billing follow-ups from triage: lock, Sentry, Dodo header, legacy-webhook delegation done in #325 round 4 (6fa2acd5, unmerged); delete legacy URL after user confirms registered Paddle URL; R1 in web/lib/stripe/webhook-handlers.ts still open
- [ ] COGS vs plan quotas decision (Pro/Light lose money at full use) → then founder prices/pools
- [ ] Legal entity + Paddle KYC (user) → gate for founder window
- [ ] Rotate (user): cfut_ Cloudflare token, Sentry token, and the Vercel vcp_ token pasted in chat

## In flight (agents, 45-min timeout each)
- None at handover time (#320, #326 merged; spikes S1–S4 have results)

## Needs the user
- Founder prices ($49/$99 vs $79/$149) after the COGS decision
- [ ] Rotate (user): Apify token + TranscriptAPI key (sk_…, 2026-09-25) too, Supadata key (sd_…, pasted 2026-09-25)

## 2026-09-25 round 1 — in flight (dispatched 01:xx, 45-min OC / 90-min AGY timeouts)
- OC GLM low: #336 round 2 (P0: conflict, native timeout, chain budget, CI) · TranscriptAPI backup adapter (new PR, stacked on #336) · #334 round 2 · #335 round 2 · Q1/Q4 rule-gap follow-up (new PR) · #327 round 3 retry
- AGY Gemini 3.1 Pro High: business case (COGS rebuild + 6-engine competitor research incl. Perplexity) → docs PR
- [x] TranscriptAPI key tested live: 200 OK, 0.4–0.6 s (Apify 7–39 s)
- [x] #337 handover contradictions reconciled (pushed)
- [ ] CC: verify each result, merge queue #336 → #334 → #335 → #331 → #325 → #327 → #337
- Key rotation: deferred to pre-production (user, 2026-09-25)
- Decisions 2026-09-25: OC providers CoreWeave→Together→Relace with fallbacks (already on main) · transcript order `apify,transcriptapi,decodo,native` (set after both PRs land; Decodo gets paid later) · Paddle: CC picks canonical route and configures it; blocked on an API key with notification-settings read/write permission (both current keys return empty data)

## 2026-09-25 round 2 — CLEAR THE DECK
- [x] #337 #331 #336 MERGED · #336 auto-deployed; live transcripts OK (dQw4 5.9 s, LTNVA 9.6 s, f6We53 17.5 s)
- [x] Original pr-review-workflow skill (V2, 10 KB) restored from ~/.gemini/antigravity-cli/skills → ~/.claude/skills (+ repo addenda)
- [x] TranscriptAPI first: order transcriptapi,apify,decodo,native; chain budget 190 s; CF secret TRANSCRIPTAPI_API_KEY set (#338)
- [x] Merge queue: #338 #323 #335 #340 merged; #339 merged BY MISTAKE (rejected round-1 business case, $0.015 COGS wrong) → AGY round 2 on same branch → open replacement PR · #334 re-queued
- [~] OC: #327 round 3 · #325 round 5 · #322 CI fixes
- [~] AGY round 2 business case — round 1 REJECTED (assumed $0.015 COGS). MEASURED: $0.153 mean / $0.160 p50 / $0.187 p90 per analysis (41 analyses)
- [x] OpenRouter account went negative (−$0.16) → user topped up
- [x] OpenRouter keys: OC + web/.env.local = dev key (KiloCode, …a4b); prod = …d99; same account pool — no change needed
- [ ] Native provider misreports "no captions" when YouTube blocks datacenter IPs (follow-up)
- [ ] Whisper last-resort provider candidate (Supadata generate mode / ADR 029) — not built
- [ ] DeepSource minor debt in transcript providers (complexity/docs) from #336 waiver
- [ ] Paddle: needs API key with notification-settings permission (user, tomorrow)
- [ ] Supadata AI-fallback provider as last tier (after #338 merges); 100 free credits/mo, AI transcription 2 credits/min
- [ ] #322: rename migration 20260924120000_merge_analysis_payload_key_rpc.sql to a timestamp after 20260924143739 (out-of-order; not applied in prod) — after OC round finishes

## 2026-09-25 round 3 — DECK CLEARED (0 open PRs)
- [x] Merged: #337 #331 #336 #338 #323 #335 #340 #334 #339(mistake, round 2 pending) #327 #341 #342 #343 #344 #325 #322
- [x] Prod migrations applied: 20260924231500_merge_analysis_payload_key_rpc, 20260925090000_seed_relations_registry_keys
- [x] TranscriptAPI live first tier (0.3–0.5 s); Supadata last tier with fail-closed AI cap
- [x] Vercel Git preview deploys disabled (vercel.json) — 100/day free cap
- [ ] User: re-run f6We53TnkbU → if stuck, Sentry "persist: invalid request payload schema" names the field
- [ ] persona/kg fragment validation failures (client Synthesis/Adapter drop) + "Validation dropped payload at stitch-analysis-chunks" ×16 → investigate
- [ ] AGY business case round 2 → replacement PR

## 2026-09-25 round 4
- [~] OC persona-kg: fragment contract fix + remove persona steering from ucis prompt (persona = indicator only, per Council/PR #232 + user 2026-09-25)
- [~] OC live-status: why reaper hasn't swept 6047514f (zero chunks) + live History card status (realtime/hooks), "stalled" state
- [~] OC qa-rules-r3: #340 post-merge rule gaps (R4 comment/overload, R13, R2, R1, allFiles)
- [ ] Business case round 3 after AGY round 2: fix arithmetic (secondary $0.05 cost, $9/$15 vs $5/$9), research script fail-open + deprecated sonar-reasoning, dedupe, sources; DELETE patch_script.cjs/.js + rewrite.py from main

## 2026-09-25 round 5 — HANDOVER: see docs/history/THOS_2026-09-25_1400_COST_AUDIT_HIGHLIGHTS_LEVERS_PLAN.md §0 and §5
- [ ] Land #345 #349 #346 #347 #348 (AGY Sonnet 4.6 reviews first) → live-verify prompt-cache savings
- [ ] ADRs 033 prompt caching, 034 Jev cascade, 035 tiered compute, 036 Jev highlight ranker; ADR 030 swoosh addendum
- [ ] AGY: business case round 3, swoosh stinger, persistent error banner + Re-analyze label
