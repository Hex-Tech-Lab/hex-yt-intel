# Competitor Pricing — Merged, Cross-Verified (2026-08-16)

Merges three sources rather than discarding prior work, per explicit instruction:
1. **Vetted Cluster B/F re-triage** from `docs/private/2026-08-12_1245_v1_SAAS_INTELLIGENCE_COMPETITIVE_ANALYSIS_GEMINI.md` — already went through a real 3-pass verification (traffic/ARR figures found unreliable and excluded; pricing/tier data confirmed reliable against real vendor pages).
2. **Batch 1** (`2026-08-16-competitor-pricing-research-batch1.md`) — 25 competitors, fresh multi-engine search.
3. **Batch 2** (`2026-08-16-competitor-pricing-research-batch2.md`) — 32 competitors, fresh multi-engine search, deliberately niche-skewed.

**Overlap found**: Summarize.tech, Mindgrasp, Sider appear in both the old vetted list and the new batches — consistent across sources, no contradiction. **Discrepancy flagged, not resolved silently**: old doc excluded Notta as a meeting-notetaker (different market); batch 1 found Notta has since added YouTube video summarization as a real feature — treated as product evolution, included with that caveat attached.

**Rule carried forward from the old doc's own verification gate**: pricing/tier/trial/refund columns are usable. Traffic/revenue/ARR figures are NOT — proven unreliable in both directions (68x overstated to 4x understated) in the prior verification pass, and neither new batch attempted to re-derive them, so none are used in this pricing decision.

## Cluster B — Direct competitors (transcript/video-native), vetted real (9)

Summarize.tech, Recapio, SocialKit, Mindgrasp, Genei, Upword, Scholarcy, Explainpaper, Scribbl AI — full detail in the source doc; Summarize.tech and Mindgrasp cross-confirmed against new batch data (see full pricing table above).

## Cluster F — Phase-2-relevant (PKM/workflow tools), vetted real (16)

Notion AI, Mem AI, Tana, Readwise Reader, Rewind AI, Roam, Obsidian, Logseq, NotebookLM, Glean, Guru, Sider, Liner, Weava, Scrintal, Napkin — reference only, not Phase-1 pricing-decision-relevant (different buyer/use-case), Sider cross-confirmed against batch 1.

## Batch 1 + Batch 2 (57 combined, new) — full detail in source files

**Pricing pattern breakdown across all 57 + Cluster B's 9 confirmed-priced entries (66 total data points)**:

| Pattern | Count (approx) | Examples |
|---|---|---|
| Flat subscription tiers only, no credits | ~20 | YSumm, Summa AI, Recall, Monica-adjacent flat tiers, YouLearn |
| Subscription + purchasable top-up/booster credits | ~14 | Gistilo (+20hrs/$3), Monica (credit packs), Happy Scribe ($0.20/min overage), TubeTutor, Sider (dynamic credit deduction) |
| Pure credit-pack, no subscription | ~6 | YT Summarizer (50/200/1000 credit packs), several batch-2 niche tools |
| Minutes/usage-metered (soft credit) | ~8 | VexaScribe, Notta, Happy Scribe base tier |
| Dual/complex credit systems (2+ credit types) | ~4 | NoteGPT (Basic Quota + Premium Credit), BibiGPT (subscription + on-demand) |
| Lifetime one-time-payment option offered | ~5 | VidCapsule ($149.99), BibiGPT ($888), Minr (batch 2) |

**Entry-tier pricing clusters tightly at $5-10/mo** across both funded and indie players (Eightify $4.99, Mindgrasp $5.99, Summa AI $9, YSumm $9.99, NoteGPT $9.99) — confirms batch 1/2's own finding, consistent with the old doc's Eightify data point too.

**Trial/free-tier policy**: free-forever thin tier is near-universal (only Mindgrasp among checked competitors has none). Time-limited trials range 3-7 days. Cardless ("no card required") free tiers are the dominant pattern, not gated trials.

**Refund policy**: almost never published — Glasp is the one explicit **non-refundable** statement found; Recall and YouLearn are the only explicit refund-window statements across all 66 data points. This is confirmed as a genuine market gap/differentiation opportunity, not an artifact of incomplete research — both old and new research independently found the same pattern.

**Update 2026-08-16 — exact refund terms fully verified, not just "they have one" (Exa+Brave, both engines):**
- **Recall**: 30-day refund on Premium, for new users only. Explicit abuse-clawback clause: "if we determine you have abused the system within those 30 days (excessive usage, automation, account sharing), we reserve the right to deny a refund." Cancel anytime, but refund only within the first 30 days. Note: Recall's marketing also says "24 Hour Support" (response-time SLA) — NOT a 24-hour refund window, a naming coincidence worth not confusing with the 24h idea under consideration here.
- **YouLearn — fully confirmed, direct from their own Terms & Conditions page**: Free-trial users get NO refund once billing starts (trial itself already granted full access — same logic hex-yt-intel already uses). Direct paid subscribers get a **7-day money-back guarantee from first payment date**, full refund, no reason required, request via email, processed in 5-7 business days. Renewals always non-refundable. Team plans <200 seats get the same 7-day window; ≥200 seats require contacting support directly, not automatic.
- **Glasp**: unchanged — "Recurring billing. Non-refundable." stated plainly on the pricing page. (Not actually one of the "2 who offer a refund" — Glasp explicitly does not.)

**So, precisely: of 66 competitors, exactly 2 (Recall, YouLearn) offer an actual refund window (30-day, 7-day respectively) — both gated by real conditions (abuse clawback / trial-already-granted-access), neither "no questions asked" unconditionally. Glasp is the 3rd data point, but as an explicit non-refund statement, not an offering.**

## General SaaS industry refund norms (not niche-specific — separate research pass, 2026-08-16, Exa)

Distinct from the 66-competitor niche scan above — this is the broader industry baseline, so the Council can weigh "typical SaaS practice" against "what this specific niche actually does" as two separate inputs, not conflated:

- **14 days is the empirically modal trial/refund-window length** across B2B SaaS broadly (32% of trials that exist use 14 days, beating 30-day nearly 2:1) — per a 9,024-tool 2026 benchmark study.
- **7-14 days is repeatedly cited as the general "sweet spot"** for a paid-subscription refund window (Dodo Payments' own co-founder, on-record: "long enough that customers feel protected, short enough you're not subsidizing a free trial through refunds").
- **For usage-consumed products specifically** (the closest general category to hex-yt-intel, since a video analysis delivers value immediately and irreversibly, same shape as "usage charges" in general SaaS guidance): the standard general-SaaS advice is explicitly **against refunding consumed usage at all** — "once the service has been used and output delivered, it is difficult to prevent abuse" — refunds in this category are typically scoped to *unused* credits only (matches Snov.io's approach in the B2B email-tools comparison found in the same pass).
- **24-hour and 48-hour windows are explicitly discussed only as an aggressive extreme**, not a normal choice: "shorter windows (48 hours) reduce refund costs but increase chargeback risk" — no source found treats 24 hours as a standard or even common practice; it is shorter than every real refund window found in this entire research pass, niche or general.
- **Healthy refund-rate benchmark**: 1-2% of charges is considered healthy; below 1% suggests the policy is too restrictive (pushes customers to chargebacks instead, which are worse for the business than refunds).

**Implication for the Council, not a pre-decided verdict**: the 24-hour figure floated earlier is shorter than anything found in real practice, niche or general — the evidence more clearly supports either (a) no refund window at all, consistent with the general usage-consumed-product norm and the current no-refund positioning, or (b) if a window is offered specifically as the "confirmation of benefit" marketing lever, something closer to the general SaaS floor (7 days, matching YouLearn, the more directly comparable niche competitor) rather than 24 hours — a real decision for the Council to make with this full evidence set, not something to lock in from a first-attempt guess.

**Booster-pack/credit-topup mechanism** (the specific pattern under consideration for this product): real and reasonably common (~14 of 66, ~21%) as a subscription+topup hybrid, rarer as pure pay-as-you-go (~6 of 66, ~9%). Gistilo's model (subscription + non-expiring topup hours while subscription active) is the closest structural analog to what's being considered here.

Full per-company detail: see the three source files linked above.
