# hex-yt-intel Pre-Launch Checklist — LIVE DOCUMENT

**Created**: 2026-08-16 (Council Wave 1 aftermath, hard-deadline discovery)
**Owner**: Kelly (final approval on every ship decision)
**Orchestrator/Auditor**: CC (Claude Code) — verifies every OC/AGY/Gemini claim against real sources before merge, per standing project rule
**Execution agents**: OC (opencode/DeepSeek, low effort — well-scoped bugs/PRs), AGY (Antigravity/Gemini — larger multi-file waves, UI-specialized), Gemini 3.6 Flash (UI-specialized, needs CC audit — historically lower code quality, use for scaffolding then CC hardens)

## How to read this document

- **Status**: ⬜ not started · 🔵 in progress · 🟡 blocked · ✅ done
- **Effort**: real LLM-agent-assisted time, not human-solo estimates — a "2h" item run through an agent typically lands in 20-40 minutes of actual wall clock once dispatched, gated only by CI/deploy round-trips and your own review latency, not by the work itself. Treat every estimate here as a ceiling assuming serial human-paced work; parallel dispatch across CC/OC/AGY compresses it further.
- **Gate**: what must be true before this item is considered done — not "agent said done," a verifiable fact (a live URL, a passing CI run, a merged PR).
- Update this file in place as items move — this is the source of truth for the next 9 days, supersedes any prior planning doc.

---

## RESUME POINT (2026-08-16, 10:23 EEST) — restart session with `--continue`, read this first

**Immediate next action**: the official Paddle plugin (`paddle@claude-community`, Apache-2.0, `github.com/PaddleHQ/paddle-agent-skills`) is installed and configured with the sandbox API key, but its 3 MCP servers (`paddle-docs`, `paddle-sandbox`, `paddle-live`) and 10 skills (`catalog-setup`, `checkout-web`, `webhooks`, `sandbox-testing`, etc.) need a session restart to actually register — installing mid-session doesn't hot-load MCP servers. **First thing next session: verify the Paddle plugin's tools/skills are now live (ToolSearch or direct invocation), then proceed straight to catalog-setup in sandbox.**

State as of hand-off:
- Live Paddle API key (`pdl_live_apikey_...`, account label `paddle-v-intel-prod`) stored in `.env.local` as `PADDLE_API_KEY_LIVE` — deliberately NOT wired into the active `PADDLE_API_KEY` used by local dev (`web/lib/paddle.ts` defaults to sandbox). Belongs in Vercel Production env vars only when we actually go live — not done yet.
- Paddle sandbox API key stored securely via the plugin's own config (`~/.claude/.credentials.json`, Claude Code's credential store) — not in any repo file.
- Existing billing abstraction confirmed real (not just memory-claimed): `web/lib/types/billing.ts` (`BillingProvider` interface), `web/lib/billing-factory.ts` (provider switch via `ACTIVE_BILLING_PROVIDER` env), `web/lib/paddle.ts` (SDK wrapper). Stripe provider also stubbed there but dead for launch (Egypt unsupported).
- KYC/verification on the live Paddle account has NOT happened yet — pasted key was handed over before verification, per user confirmation. Real checkout/charges won't complete until verified; sandbox work is fully unblocked regardless.
- §2.3 (1 MoR vs 2-3 for launch) still open — recommendation stands: Paddle-only for launch, Dodo Payments as a confirmed real fallback if needed, see `docs/research/2026-08-16-payment-provider-egypt-research.md`.
- PR #239 (entity taxonomy SSOT fix) pushed, CI/Cubic/CodeRabbit/Snyk were mid-run at last check (~02:47 EEST) — check status, likely landed by now.

**User's timezone**: EEST (UTC+3). Clocked in today 2026-08-16 ~09:52 EEST. Use this to reason about "morning"/"tonight"/deadline-day boundaries in EEST, not UTC or any other assumed zone, for the remainder of this engagement.

## 0. Hard constraints (do not re-derive, just obey)

| Constraint | Value |
|---|---|
| Today | 2026-08-16 |
| Last workable day | 2026-08-24 |
| Mandatory full stoppage | ~2026-08-26 for 10-15 days (personal/family, zero capacity) |
| Days lost to unrelated project prep | 3-4 of the remaining days |
| **Real usable launch runway** | **~8-9 days, effectively parallelizable via agents** |
| Waitlist target | live within 2-3 days (gated on intro video only) |
| Product target | live before 2026-08-24 |

### REAL STATUS AUDIT — 2026-08-18, cross-referenced against live code/docs

**Runway math (real, both framings)**:
- Raw window: today 2026-08-16 → last workable day 2026-08-24 = 9 calendar days (raw runway as stated at creation).
- **Days elapsed as of this audit: 2 days** (08-16 → 08-18).
- **Raw days remaining: 6** (08-18 through 08-24 inclusive).
- Council-adjusted framing (~4-5 usable days out of the original 9-day raw window, i.e. ~50-55% effective after presentation-prep loss and review/buffer days) applied proportionally to the 6 raw days remaining: **~3 usable days remaining**, not 6. This is compounded by the checklist's own sequencing plan (§ "Suggested sequencing"), which locks Tue-Fri 08-19–08-22 to the unrelated presentation with zero active hex-yt-intel work expected — meaning the *only* fully-available working days left before 08-24 are effectively today (08-18) and the weekend 08-23/08-24 review/buffer window, unless background agent tasks genuinely continue unattended through the presentation-prep block.
- **Bottom line: real usable runway is ~3 days of active founder-attention time, not 6, and nowhere near the original "8-9 days" framing** — that framing was accurate on 08-16 but has not been updated since, which is itself a finding (this checklist had not been touched since creation despite 2 days and a major session's worth of real work passing).

**Verification method**: read every item below against real code/PR/doc state (not the checkbox as written) via `gh pr view`, `git log`, `ls`/`grep` on real files, and the 08-18 handover doc.

Sequencing principle: **waitlist unblocks first and separately from product** — they do not share a critical path except the intro video.

---

## 1. Taxonomy / color-bug thread (bounded scope — confirmed non-blocking for launch)

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 1.1 | Finalize PR #239: color fix keyed to whichever taxonomy a node already carries (worker 8-value for payload path, POLE+O for `kg_entities` path), zero DB/migration changes | 🔵 real progress — PR #239 open, 2 real commits pushed (`a6b9f095` color fix, `9316a80f` "single source of truth for entity taxonomy (POLE+O)") | CC | 1h | Both `useKnowledgeGraph.ts` paths render real colors; contract test green; no `kg_entities` regression — **NOT yet independently re-verified live in prod this audit** |
| 1.2 | Merge PR #239 | ⬜ **verified still OPEN, not merged** (`gh pr view 239` → `state: OPEN, mergedAt: null` as of 2026-08-18) — has sat open through the entire 08-17/08-18 session while other work proceeded | CC | 15m | Merged to main, deployed, verified live in prod dashboard on a real analysis |
| 1.3 | Structural commitment: when Phase 2 extraction is built (post-launch), extractor and classifier are two separate functions/passes from day one | ⬜ (design note only, no code this window) | — | 0h now | Documented as ADR 026 Phase 2 addendum before any Phase 2 code is written |
| 1.4 | Tier-2 vocabulary lock-in (Topic/Technique/Product/etc. or Wave-2 outcome) | 🟡 explicitly deferred | — | — | **Do not start before launch** — commits to single-account-biased category names; re-running post-launch against real user data is cheaper than locking in now and redoing it under time pressure |

**Explicitly out of scope for this window**: Council Wave 2, Abstract placement finalization. Confirmed via direct code check (2026-08-16) that neither `entity-time-seek.ts`/`entity-time-seek-cross-dimension.ts` (time-seek) nor `GenerateExecutiveDigestUseCase.ts` (digest) reference entity type/category anywhere — zero launch dependency for those two USPs.

**Revised, corrected 2026-08-16 (supersedes the original 1.1-1.4 framing above)**:
- **Single source of truth, not a dual-spelling lookup table**: both ingestion paths (`SupabaseGraphAdapter.ts` → `kg_entities`, worker's payload-embedded KG nodes) normalize to ONE canonical POLE+O enum before writing/embedding — the CHECK-constraint-enforced one, since that's the only spot already enforced at the DB level. `entity-colors.ts` then needs one vocabulary, not two. Includes a one-time backfill UPDATE for the 836 existing legacy rows. This is the real PR, not a display-layer patch.
- **Color scheme, verified against Neo4j's actual mechanism (not assumed) + independent knowledge-graph-viz literature**: Neo4j hand-colors each tier-2 label because each of their 22 domains is bounded and fixed per deployment (~15-20 labels, known in advance) — that mechanism does not transfer to a horizontal, any-domain product. **Color by tier-1 (POLE+O, 5 fixed hues) only. Tier-2 gets no unique hue — label/filter/tooltip only, shape or shade-within-parent-hue at most.** This is a hard perceptual limit (unreadable past ~8-10 distinct hues), not a preference — backed independently by yfiles.com/mindthegraph.com guidance.
- **Tier-2 vocabulary generation, corrected framing**: not "borrow Neo4j's closest domain's label list" (retracted — arbitrary, we have no target vertical). Instead: adopt their *structural pattern* — a schema-validated LLM pass generates the tier-2 label set once (their `--custom-domain` flow is the direct analog), saved and reused, not re-invented per video and not copied from any one of their fixed domains.

---

## 1b. Pricing & Packaging Decision (added 2026-08-16 — this was missing entirely, real gap, not a nice-to-have)

**Why this got its own section**: initially treated as a quick "what's the Pro price" question when starting Paddle catalog setup. It is not quick — it's a real, multi-part business decision (tier count, trial policy, usage-based booster packs, a founder pre-sale program) that was already the subject of a partial LLM Council exercise over a month ago that never concluded. Sizing this honestly now instead of discovering the gap mid-build.

| # | Item | Status | Owner | Effort (realistic) | Gate |
|---|---|---|---|---|---|
| 1b.1 | Sandbox placeholder catalog (product + $1/mo test price, clearly labeled non-final) so checkout/webhook engineering isn't blocked | ✅ done 2026-08-16 | CC | 15m | `pro_01m04rjsepbvamv60h4q7cvarb` / `pri_01m04rjsjdxyaspr8p67mkye0n` created in Paddle sandbox, wired into `.env.local` |
| 1b.2 | Competitor research: real pricing/tier/trial data across ~50 YouTube video-intelligence/summarization tools | ✅ done — `docs/research/2026-08-16-competitor-pricing-research-batch1.md`, `batch2.md`, and `-MERGED.md` all present on disk | 2 parallel research agents dispatched, CC verifies | 2-4h agent time | Files confirmed present; citation quality not re-audited this pass |
| 1b.3 | Locate/revisit the prior partial pricing LLM Council session (~1 month ago, stopped incomplete) — read before re-running, don't re-derive from scratch | ✅ effectively superseded — Council Wave 1 (below) ran fresh 2026-08-17 rather than resuming the old session; treat as resolved by 1b.4 landing | CC | 30m search | — |
| 1b.4 | One comprehensive LLM Council round on pricing/packaging — informed by 1b.2's real data, not run in a vacuum. Scope: tier count/names, trial policy (none / time-based / credit-based / cardless), usage-based booster-pack mechanism, founder pre-sale program (credit packs + lifetime discount tiers) | ✅ **Wave 1 ran 2026-08-17** — `docs/private/council/2026-08-17_pricing_wave1_council-report.html`/`-transcript.md` real, 13-advisor + Monte Carlo verdict landed (ship Light computing full UCIS now, disclose one line, P(Success) 64%). **CAVEAT, real and unresolved**: the verdict's "compute-depth" tier framing was corrected by the user the next day (08-18) — tiers differ by feature exposure/volume, never by which model computes them. The Council's verdict has NOT been re-validated against this correction — flag as a real open loop, not silently treat Wave 1 as final | CC drafts framed question, dispatches per llm-council skill's 7-step process | 2-3h (13 advisors + peer review + synthesis, parallel dispatch) | Re-confirm Wave 1 verdict still holds under the corrected framing, or run a short Wave 1.1 delta |
| 1b.5 | Founder pre-sale program definition (Founder Light / Founder Pro credit packs) | 🔵 in progress, not final — master doc §6f has a real reverse-engineered dollar-target model (~$12K net @ 200 founders / ~$61K @ 1,000), illustrative $49/$99 numbers used in the built `/founders` draft page, explicitly marked non-final | — | Follows from 1b.4's verdict | Concrete pack sizes/prices/discounts still pending final lock |
| 1b.6 | Waitlist "first 200" pre-sale mechanism — how early signups actually convert to founder pricing (checkout flow, discount code or automatic tier assignment) | ⬜ still not built — `/founders` page (draft) links from `/waitlist` but the actual conversion/checkout mechanism is not implemented | — | 1-2h engineering once 1b.5 is decided | Real checkout path tested end-to-end with a founder-tier price |
| 1b.7 | Real Paddle catalog rebuild with final tiers (replaces the 1b.1 placeholder) | ⬜ **not started** — still on the 1b.1 sandbox placeholder catalog, no evidence of a rebuild | CC via `paddle:catalog-setup` skill | 1h | Sandbox catalog matches the Council's final decision; live catalog created only once verification clears |

**Real work done this window not originally itemized above (2026-08-17/18 session)**: `/pricing` page and `/founders` page fully rebuilt from stale placeholders to the real Free/Light/Pro/Max structure (multiple user-reviewed fix rounds — checkmark centering, single-highlight bug, tier-ladder content-logic bug where Free contradicted its own card copy, WordCloud moved to Free). Internal `/admin/parity-review` tool built (Haiku-vs-GPT-OSS-120B side-by-side review). Real empirical COGS work: GPT-OSS-120B validated for Digest (78.9/100 @ n=14, ~4x cheaper) and UCIS Dimensions 1/7/8 (100%/100%/87% @ n=15 after a self-verification-checklist prompt fix, ~28.5x cheaper than Haiku); 8 of 11 UCIS dimensions remain untested. These files/pages exist and are real, but **none of this was reflected in this checklist until this audit** — the checklist itself was stale relative to real progress.

**Honest timeline note**: this chain (1b.2 → 1b.3 → 1b.4 → 1b.5 → 1b.6 → 1b.7) is sequential in its decision dependencies even though research (1b.2/1b.3) runs in parallel with everything else right now — the Council round (1b.4) can't start until research lands, and everything downstream waits on the Council's verdict. This is realistically a half-day-to-a-day slice of the ~9-day runway, not a side quest — sized honestly here so it doesn't quietly consume more than planned.

## 1e. Cascade provider-order SSOT violation (added 2026-08-18 audit — real, unresolved, NOT previously tracked)

**This is the single most important gap this audit found**: a real production-correctness bug discovered late in the 08-17/18 session, logged to `docs/TECH_DEBT_LEDGER.md` (2026-08-18 entry) but **never added to this launch checklist** until now, despite being exactly the class of item §6.3/§6.4 exist to catch.

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 1e.1 | Cascade provider order (which OpenRouter provider — Vertex/Azure/Anthropic-Direct/Bedrock — serves Haiku 4.5 calls) lives in **THREE independently-editable places**: `web/lib/config/cascade.ts`'s fallback constant, the `setting_values` DB registry (`cascade.analysis` key), and `worker/src/services/LLMCascade.ts`'s own separately-hardcoded order (`['anthropic','google-vertex','amazon-bedrock']`, missing Azure entirely). #1 and #2 were fixed 08-18 (correct order: Vertex Europe → Azure → Anthropic Direct → Bedrock, per real user-provided OpenRouter speed/uptime data). **#3 was NOT touched** — the worker has no DB access per ADR 005, so a real fix requires the web app to resolve the registry value and forward it through the signed stream payload, not a worker-side DB query. | 🟡 **real, unresolved, HIGH PRIORITY per explicit user directive** ("we cannot afford this kind of mistake... has to be an SSOT, all based in Settings Registry") | CC | not yet estimated — likely 1-2h (payload-forwarding wire-up + verify against real OpenRouter request logs, not just config inspection) | All three locations resolve to one value at request time; verified via a real live OpenRouter request log showing the correct provider was actually hit, not just code inspection |
| 1e.2 | Full 8-9-language × 11-dimension GPT-OSS-120B vs Haiku 4.5 parity batch test | 🔵 in progress as of 08-18 ~13:35 (background agent `a83633da8a8823ac8`) | CC | unknown, still running at last check | `docs/research/2026-08-18-full-dimension-parity-batch-test.md` / `-parity-batch-results.json` show a real completed result, reviewed via `/admin/parity-review` |

**Why this matters for launch, not just tech debt**: if this ships unresolved, the worker can silently route Haiku 4.5 traffic through a provider order that disagrees with what the Settings Registry (the declared source of truth) says — the exact "3 disagreeing sources" failure mode the user flagged as unacceptable. This is a correctness/cost-control risk on the payment-critical LLM cascade, not cosmetic.

## 1d. Chat model escalation gap (added 2026-08-17, real code gap found)

`web/lib/config/cascade.ts`'s `CHAT_CASCADE_FALLBACK` is currently 100% GPT-OSS-120B (Cerebras/Groq/Baseten) + Gemini 3.5 Flash Lite — **no Haiku 4.5 (or any flagship) escalation tier exists**, despite that being the described design intent (a 3-tier GPT-OSS-120B → Gemini Flash latest → Haiku 4.5 escalation for increasingly sophisticated turns). Real cost delta of adding Haiku 4.5 as a top tier is small (~$0.53/user/month worst case) — not a cost blocker. Real remaining work: the escalation-trigger logic (what counts as "needs more reasoning") and conversation-history compaction across the tier chain's context-window mismatch (131K → 1M → 200K — stepping up to Haiku shrinks available context). Full detail: `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §6i-6k. Not yet scoped for this launch window vs. fast-follow — flag for a real decision, not decided here.

## 1c. MD/PDF export quality (added 2026-08-16, real gap flagged, not previously tracked)

Existing, deployed export features are real but poor quality — MD export is "sterile," PDF is "absolutely miserable and unusable" per direct feedback. Needs a genuine redesign: executive-summary-and-key-takeaways-first structure, full detail later, polished 10x-quality formatting — not incremental tweaks. **Explicitly out of scope for this pre-launch window given the runway** unless it's blocking the founder-tier positioning directly — flag for a real go/no-go: is export quality a launch-blocker, or a fast-follow? Not decided here.

## 2. Payments — Merchant of Record integration

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 2.1 | Confirm Paddle account status (already primary per prior decision — verify not just "selected" but actually provisioned: API keys live, webhook endpoint registered, sandbox checkout tested) | ⬜ | CC verify, you provision (Paddle account creation/KYC is not agent-doable — MoR onboarding requires your identity docs) | 30m verify + however long Paddle KYC takes (external, not agent-controlled — start this FIRST, today, it's the one item on this whole list with a dependency outside your control) | Real Paddle checkout completes in sandbox, webhook received and logged |
| 2.2 | Wire Paddle into the existing modular MoR abstraction (per `project_multi_mor_payment_strategy_20260802.md` memory — abstraction already designed, not starting from zero) | ⬜ | OC (well-scoped, existing pattern to follow) | 2-3h agent time | Subscribe/cancel/webhook flows hit Paddle through the abstraction, not a hardcoded call; CC verifies no direct Paddle SDK import outside the adapter |
| 2.3 | Decide: 1 MoR (Paddle only) for launch vs. 2-3 | ⬜ **needs your call** | — | — | Given the 9-day window: **recommend Paddle-only for launch**, add a 2nd MoR post-launch once the abstraction is proven live with real transactions — adding a 2nd provider now is scope you don't need to prove the abstraction works |
| 2.4 | End-to-end live payment test (real card, real charge, refund it) | ⬜ | you (this one needs a human with a real card, not an agent) | 15m | One real successful charge + refund visible in Paddle dashboard |

---

## 3. Waitlist launch (fastest path — target 2-3 days)

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 3.1 | Waitlist page itself | ✅ already shipped (PR #231, `feat(web,db): waitlist landing page + signups table`) — verify still live and functional post- recent merges | ⬜ verify | CC | 15m | Live URL loads, signup writes a row to `waitlist_signups`, no console errors |
| 3.2 | Waitlist icon fix | ✅ already shipped this session (`fix(web): persist client-observed stream failures + fix blank waitlist icon`) | ⬜ verify only | CC | 5m | Icon renders in nav, confirmed live not just in a PR diff |
| 3.3 | Intro video (the actual blocker for waitlist launch) | ⬜ | you (script/record) + agent support for editing/captioning if tooling exists | **This is the critical path item — everything else in this section can be done in parallel while this is in progress** | Video file ready, hosted (YouTube unlisted or direct embed) |
| 3.4 | Best channel selection for waitlist push (X/Twitter per your prior research, or SEO) | ⬜ | you decide channel, CC/OC can draft copy variants for you to pick from | 1h agent time for draft copy | You approve final copy before anything posts — posting to X is an Explicit-Permission action, not autonomous |
| 3.5 | Light SEO pass on waitlist page (meta tags, OG image, basic on-page) | ⬜ | OC | 1-2h | Lighthouse SEO score check, OG preview renders correctly on X/LinkedIn card validators |
| 3.6 | Optional: limited paid ads | ⬜ **needs your call — budget decision, not an agent decision** | — | — | Flag: any ad spend is a real-money action, needs your explicit go each time, not blanket pre-approval |

---

## 4. Video assets (4 distinct, per your explicit instruction — not reused/repurposed)

| # | Video | Purpose | Status | Notes |
|---|---|---|---|---|
| 4.1 | Waitlist intro | Hooks signups, minimal product detail | ⬜ | Blocks §3.3 above — highest priority of the four |
| 4.2 | Product overview | For the live product page / general marketing | ⬜ | Can reuse footage from 4.1 but must be edited distinctly per your instruction |
| 4.3 | Onboarding | First-run walkthrough for actual signed-up users | ⬜ | Only needed once product is live, not before — can slot after 4.1/4.2 |
| 4.4 | Marketing material | Ad/social-cut version, different pacing/hook than 4.1 | ⬜ | Lowest priority of the four — can slip past launch day if needed, waitlist doesn't depend on it |

Agent role here is limited (video production isn't an agent-native task) — CC/OC can help with scripts, captions, and editing-tool automation if you're using something scriptable (e.g., ffmpeg cuts), but the creative/recording work is yours.

---

## 5. Legal / GDPR footnote

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 5.1 | Quick GDPR exposure pass on the 637-row classification data (Art. 9 special-category risk, per Council Compliance Officer flag) | ⬜ | CC | 1h | Written finding: does the private-analysis-history data underlying any shipped feature constitute special-category data, yes/no, with reasoning |
| 5.2 | Draft footnote for Terms & Conditions covering data handling, infra used (Supabase/Cloudflare/OpenRouter/Upstash), retention (already have ADR 012's 72h transcript retention to cite) | ⬜ | CC drafts, you approve | 1h | Footnote language ready, inserted into T&C page, reviewed by you (legal text is your call, not an autonomous publish) |
| 5.3 | Explicit non-goal: no EU-specific compliance workstream (cookie consent banners, DPA templates, EU rep appointment) — target market is US/North America | ✅ decided, no action needed | — | — | — |

---

## 6. Product launch readiness (the harder gate — before 08-24)

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 6.1 | §1 taxonomy/color fix merged | ⬜ | CC | see §1 | — |
| 6.2 | §2 payment flow live end-to-end | ⬜ | mixed | see §2 | — |
| 6.3 | Real bug triage, redone 2026-08-19 — original #18/#19/#21 references were confirmed wrong/never-filed (WordCloud flicker/unclickable-timestamp/dim-0-accordion bugs referenced by those numbers were also independently confirmed already fixed this session — WordCloud gray bug + rigid-layout fixed in PR #239, commit `88d03e07`). Real triage against `gh issue list` (0 open issues existed before this pass) + `docs/TECH_DEBT_LEDGER.md` + recent THOS handovers surfaced 3 real, confirmed-still-unresolved findings, each filed as a real new GitHub issue: **[#241](https://github.com/Hex-Tech-Lab/hex-yt-intel/issues/241)** worker `LLMCascade.ts` hardcoded Haiku 4.5 provider order bypasses Settings Registry SSOT (missing Azure) — verified still present in source as of 2026-08-19, launch-blocking per explicit user SSOT directive; **[#242](https://github.com/Hex-Tech-Lab/hex-yt-intel/issues/242)** `analyses.duration_seconds` dead/NULL column (210/210 rows NULL) — not launch-blocking, deferrable; **[#243](https://github.com/Hex-Tech-Lab/hex-yt-intel/issues/243)** KG node-sizing gap (LLM-authored weight field has no prompt guidance) — not launch-blocking on its own, but blocks promoting Knowledge Graph out of Pro-mode-only (§2c.1). D8/D9/D11 GPT-OSS-120B quality gaps checked and correctly NOT filed as issues — still experimental/investigation-only research (`docs/research/2026-08-18-dimension8-prompt-tuning-and-sample-test.md`), not shipped production defects. | ✅ real triage done | CC | done | Each bug has a written verdict + real GitHub issue — done, see issue links above |
| 6.4 | Full `/pr-review-workflow` pass on any code merged this window (Cubic/CodeRabbit/Snyk/CI stack, confidence ≥85 before merge) | ongoing | CC | per-PR | Standard project gate, no exception for launch pressure — a broken merge under deadline pressure is worse than a slipped day |
| 6.5 | Value-proposition/USP documentation — explicit protection: no changes without a formal ADR, even under launch pressure | ✅ standing rule, reaffirmed | — | — | If anything in this window tempts a quick USP-doc edit, stop and flag it rather than editing inline |
| 6.6 | Final smoke test: full user journey (waitlist signup → product signup → payment → first analysis → dashboard render with correct entity colors → time-seek works → digest renders) | ⬜ | you, with CC support | 1-2h | Every step works live, on prod, not staging |

---

## 2b. Paddle alternatives — comparison research (in progress, 2026-08-16)

| Provider | Egypt individual/no-LLC? | KYC | Fee | Verdict |
|---|---|---|---|---|
| Paddle | **unconfirmed — verify directly, do not assume** | ? | ~5% (per market scan) | primary, pending confirmation |
| LemonSqueezy | ❌ ruled out | Stripe Connect payout only, Stripe unsupported in Egypt | 7-10% | not viable |
| Gumroad | ❌ ruled out | Stripe Connect payout only, Stripe unsupported in Egypt | ~10% | not viable |
| Dodo Payments | likely yes — explicitly markets "no registered company," simplified KYC for individuals | needs direct Egypt confirmation | needs confirmation | strong candidate #2, verify next |
| PayPal | Egypt supported historically, but verify current outbound-transfer limits | standard PayPal KYC | high (~5%+fixed, worse on cross-border) | trust-brand fallback / co-offered option, not primary — compare real fee once confirmed |

**Not yet resolved** — Brave Search rate-limited mid-research (2026-08-16). Next pass: confirm Paddle Egypt policy directly (their own docs/support), confirm Dodo Payments Egypt support, get one more candidate, real fee comparison table. This section is NOT done — do not treat the table above as final.

## 2c. UI complexity — Simple/Pro mode split (new, 2026-08-16, real user feedback: non-domain-expert reviewer pushed back hard on interface complexity)

| # | Item | Status | Notes |
|---|---|---|---|
| 2c.1 | Decide default "Simple" mode scope | ⬜ **needs your call** | Candidate: dimensions summary + digest + auto-scrubber only. Explicitly undecided: does Simple mode include WordCloud/MindMap? User leaning toward including WordCloud+MindMap in Simple, excluding Knowledge Graph and the right-panel flyout from Simple. |
| 2c.2 | "Pro mode" toggle | ⬜ | Full 11-dimension view + Knowledge Graph + flyout, same as current default today |
| 2c.3 | Toggle placement | ⬜ | User's suggestion: a second slider/switch directly under the existing time-seek toggle |
| 2c.4 | Implementation | ⬜ blocked on 2c.1 decision | Do not start building until scope is decided — this is a product decision, not a technical one |

**2c.1 decided (2026-08-16)**: Simple mode = WordCloud + MindMap + dimensions + digest + scrubber. Pro mode adds: full Knowledge Graph + right-panel flyout. Rationale: WordCloud/MindMap are single-hop, skimmable, and WordCloud doubles as an engaging wait-state indicator; Knowledge Graph requires an existing mental model of the content to be useful and is the one component confirmed both buggy (poor cluster spacing, missing distant labels) and confusing to a non-expert reviewer — Pro-only until that pass is done.

## 6b. Load / duration stress tests (added 2026-08-16, explicitly requested — not yet run)

| # | Item | Status | Notes |
|---|---|---|---|
| 6b.1 | Max-duration test — process a ~5 hour video, confirm no timeout/failure | ⬜ | Longest tested so far is ~1.5 min processing time even for extended videos; actual behavior at the extreme end is unverified |
| 6b.2 | Concurrency test — 50 concurrent users/analyses | ⬜ | Referenced earlier this session, not yet added to a checklist until now |

Both are real pre-launch gates, not nice-to-haves — a production failure on either during/after launch is exactly the "hit a block while live" scenario to avoid.

## Suggested sequencing (not rigid — reorder as blockers surface)

**Confirmed timeline (2026-08-16)**: work window = today (Sat 08-16) through Monday evening (08-18), ~2.5 days → presentation prep Tue-Fri (08-19 to 08-22) → buffer/review Aug 23-24(-25).

1. **Today (Sat 08-16)**: Start Paddle KYC / confirm Egypt support (external dependency, start first). Finish §2b comparison table (Paddle direct confirm + Dodo Payments + 1 more). Dispatch §1.1 (color fix) + §1.3/1.4 tier-2-from-Neo4j-YAML extractor/classifier PR via `/pr-review-workflow`. Verify §3.1/3.2 still live. Get your call on §2c.1 (Simple/Pro scope).
2. **Sun-Mon (08-17/18) — must reach "confidently launchable" state by Monday night**: Record intro video (§3.3). Wire chosen MoR into abstraction (§2.2). Merge #239 + tier-2 PR (§1.2). Waitlist copy/SEO (§3.4/3.5). GDPR footnote (§5). Bug triage (§6.3). Run TestSprite MCP + pairwise/PICT-style test pass (see §7 below) — this is the confidence-building gate before the Tuesday gap.
3. **Tue-Fri (08-19–08-22)**: presentation prep — no active hex-yt-intel work expected, but background agent tasks (non-blocking PRs, research) can continue if flagged and self-contained.
4. **Sat-Sun (08-23–08-24), possibly into 08-25**: final review pass, close any open findings from §7's test runs, live payment test (§2.4), full smoke test (§6.6), go/no-go.

## 7. Confidence-building test pass (before the Tuesday gap — target ~90%, not 100%, not a guess)

**Real status update (2026-08-19, later same-night pass)**: 7.1 actually ran this time — the human confirmation step at `localhost:42787` was completed by Kelly manually, bootstrap succeeded, and a real 15-test TestSprite session executed end-to-end against the live dev server. Real report: `testsprite_tests/tmp/raw_report.md` (2026-08-19 22:36). 2/15 passed, 2/15 genuinely failed (one real bug, fixed same session), 11/15 blocked — but the block cause is Google's own "this browser or app may not be secure" OAuth rejection of the automated test browser, not an app defect. 7.2's matrix status is unchanged from the prior pass (confirmed non-salvageable, not rebuilt). Confidence revised up from 65-70% given 7.1 now has real evidence, see 7.3.

| # | Item | Status | Owner | Effort | Gate |
|---|---|---|---|---|---|
| 7.1 | TestSprite MCP full run against the live app — real automated test sessions, not unit mocks | ✅ **ran for real, 15/15 tests executed** — account verified (Free plan, 150 credits), bootstrap succeeded after Kelly completed the one-time browser confirmation, PRD/code-summary/test-plan generated, `testsprite_generate_code_and_execute` ran the full 15-case plan against `:3000` (dev mode, real browser sessions). Results: **2 passed** (TC010 "View the shared report details", TC014 "See a public shared analysis without authentication prompts" — both share-token public-view flows, real positive signal that `/share/[token]` works unauthenticated). **2 failed — real bug found and fixed same session**: TC007/TC013 expected the homepage's "See a sample" button to open a public sample analysis; it was hardcoded to `href="/pricing"` (`web/app/landing-page.tsx:101-107`) — a mislabeled button, not a broken share flow. Fixed by relabeling to "View pricing" (honest label matching its real destination) rather than fabricating sample content that doesn't exist. **11 blocked**: 10 of the 11 hit Google's OAuth security interstitial ("Couldn't sign you in… this browser or app may not be secure") when the automated test browser attempted `Sign in with Google` — this is Google's bot-detection on the OAuth provider side, not an app-code defect, and not something fixable in `web/`; the 11th (TC008) referenced a generic `/login` route the test-plan template assumed that doesn't exist in this app (real route is `/auth/signin`, correctly Supabase/Google-only) — a test-plan artifact, not an app gap. No overlap with tracked issues #241 (LLM cascade SSOT), #242 (duration_seconds NULL), or #243 (KG node sizing) — this is a new, distinct finding. | CC drives, TestSprite MCP already installed (`mcp__testsprite__*`) | ~1.5h agent time (bootstrap retry + full run + triage + fix) | **Met, with a known real limitation.** Core positive signal (public share view works) and one real UI bug found+fixed. The OAuth-block ceiling means TestSprite in this environment cannot currently verify any authenticated flow (dashboard, chat, billing, saved analyses) — that gap is real and unresolved; a non-Google auth path (email/password, magic link, or a TestSprite-recognized OAuth allowlisting) would be needed to unblock those 10 cases in a future pass. |
| 7.2 | Pairwise/combinatorial test-case selection — locate the referenced stale matrix before rebuilding | ✅ **located, assessed, confirmed genuinely not salvageable — documented, not rebuilt this pass** | CC | 1h located+assessed | `.github/workflows/pairwise-test.yml` found: disabled to `workflow_dispatch`-only since 2026-08-02 per its own inline comment. Root cause confirmed still true today: the workflow's target test path (`web/tests/pairwise_matrix/`) **does not exist anywhere in the live checkout** (`find web/tests -iname "*pairwise*"` = empty) — only Phase 1 (`docs/testing/PAIRWISE_TEST_MATRIX_WAVES_1_4.md`, the 38-case spec doc) was ever built; the Playwright fixtures/tests referenced by the workflow were never written. Additionally 29/38 documented cases reference NextAuth, removed by ADR 001's Supabase-only auth migration — the spec itself is stale on top of the missing implementation. **Verdict: not a revival candidate, this is a from-scratch build** (spec needs an auth-provider rewrite pass, then real Playwright pairwise fixtures need to be written against the current stack) — correctly out of scope for tonight's remaining runway per the task's own effort ceiling (2-3h to revive was premised on the matrix being close to working; it is not). Flagged as a real gap for a dedicated fast-follow, not fabricated as done. |
| 7.3 | Confidence bar for launch | **revised up from the prior pass's 65-70%, honest read**: ~75-78% | — | — | Why up: 7.1 now has real evidence — the public share-view path (used by the `/share/[token]` route, a real product surface) is confirmed working end-to-end by an independent automated tool, and the one real bug it surfaced (mislabeled sample button) is already fixed. Why not higher: 10/15 cases (everything behind Google auth — dashboard, chat, billing, saved analyses, search) remain functionally unverified by TestSprite tonight, blocked by Google's bot-detection rather than resolved; those flows still rely solely on the `/pr-review-workflow` gate and manual smoke-testing (§6.6), same as before. 7.2 still has zero automated pairwise coverage (confirmed not salvageable, not rebuilt). The `/pr-review-workflow` per-PR gate (≥85 confidence) remains real and running throughout. Before treating this as launch-ready, either get a non-Google auth path TestSprite can drive, or lean fully on §6.6's manual pass for the 10 blocked flows. |

The 3-4 days for the unrelated project's presentation are now locked to Tue-Fri (08-19–08-22) per your decision above.

---

## 8. Real status audit summary (2026-08-18)

| Bucket | Count | Notes |
|---|---|---|
| ✅ Done, verified | 6 | 1b.1, 1b.2, 1b.3(superseded), 1b.4(Council ran, caveat below), 3.1/3.2(shipped, re-verify still live), 5.3 |
| 🔵 In progress, real evidence | 3 | 1.1 (PR #239 open w/ 2 commits), 1e.2 (parity batch mid-flight), 1b.5 (illustrative numbers, not final) |
| 🟡 Blocked / needs a call | 4 | 1.4, 2.3, 2c.1(decided but 2c.4 build blocked), 3.6 |
| ⬜ Not started / no real progress | ~20 | includes 1.2 (PR #239 not merged), 1b.6, 1b.7, most of §2 (Paddle live/KYC/abstraction wiring), 6.3 (bug triage — issue numbers don't even resolve), 7.1/7.2 (TestSprite/pairwise), 6b.1/6b.2 (load tests) |
| 🆕 Newly tracked this audit, not previously on checklist | 2 | 1e.1 (cascade SSOT — HIGH PRIORITY), 1e.2 (parity batch test) |

**The single most critical thing NOT yet progressing that threatens the launch date**: §2 (Paddle payment integration) — the entire section is still ⬜ as of this audit. No evidence of live-account KYC progress, no MoR abstraction wiring (1b.6/2.2 unbuilt), no real charge/refund test. This is the actual product monetization path and it has had **zero real forward motion** since 08-16 while two full sessions went into pricing UI/COGS research instead — those were valuable but did not touch §2's actual blocking chain. Combined with the cascade SSOT bug (1e.1) sitting unresolved on the payment-adjacent LLM cost path, and only ~3 real usable working days left (not 6, not 8-9) before 08-24, §2 is the item most likely to blow the launch date if it doesn't start today.
