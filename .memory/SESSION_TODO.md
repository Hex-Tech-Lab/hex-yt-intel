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
- [ ] Rotate (user): Apify token + TranscriptAPI key (sk_…, 2026-09-25) too
