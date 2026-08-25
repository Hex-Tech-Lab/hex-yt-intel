# Competitor Comparison Table for LLM Council Pricing Round (2026-08-18)

Builds on `docs/research/2026-08-16-competitor-pricing-MERGED.md` (66 competitors surveyed for pricing/refund patterns) — this doc does NOT re-run that survey. It (1) expands with fresh multi-engine search (Exa + Brave) focused on the *feature depth* dimension that survey deliberately left aside, (2) adds real user-sentiment sourcing, (3) inserts hex-yt-intel's own real row from `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §2, and (4) chases the Greg Isenberg pricing-elasticity reference.

**Source-quality caveat, stated up front**: most of the fresh search results are SEO/affiliate blog posts (blog.ytsummarizer.app, tube-u.com, you-tldr.com, rightaichoice.com, tooltivity.com) that are themselves competitors or affiliates reviewing the category — several visibly steer toward their own product ("YT Summarizer," "Tube-U," "YouTLDR" all rank their own tool #1 in their own comparison post). Pricing figures were cross-checked against ≥2 independent sources where possible and are flagged inline where only one weak source exists. App-store review data (Apple App Store, Chrome Web Store, Product Hunt) is treated as higher-trust since it's platform-verified, not vendor-authored.

---

## 1. Expanded competitor set (beyond Eightify/NoteGPT already covered)

Real, current, named competitors surfaced across ≥2 independent sources (Exa + Brave), not previously detailed in the merged doc's Cluster B/F depth-of-feature terms:

| Tool | Category fit | Notes |
|---|---|---|
| **Glasp** | Direct (highlighting + AI summary) | Free, browser extension, social/public-highlight model, multi-LLM backend (user's own ChatGPT/Claude/Gemini key). Confirmed non-refundable stated policy (from earlier merged research). |
| **Summarize.tech** | Direct, free-only | No login, unlimited, paragraph-style output only — no dimensions, no KG, no chat. Already in Cluster B, re-confirmed here. |
| **NotebookLM (Google)** | Adjacent, free | 50-source free tier, strong at cross-source research synthesis, notably NOT single-video-dimension-depth focused — a different job-to-be-done. |
| **Notta** | Adjacent (meeting/transcript-first) | Already flagged in merged doc as a market-evolution case (added YouTube summarization). Pro ~$8.17/mo annually, 58 languages, minute-capped. |
| **Mindgrasp** | Direct | Already in Cluster B; re-confirmed $10-15/mo range here (was $5.99 entry in merged doc — likely reflects different tier, see pricing table below), quiz generation, no free tier confirmed in both passes. |
| **YT Summarizer** | Direct, one-time-credit model | New data point: $9-$49 one-time credit packs, no subscription, explicitly marketed against subscription fatigue. Real structural alternative to the subscription-only pattern that dominates this market — worth flagging for the Council given hex-yt-intel currently prices as pure subscription. |
| **Tube-U** | Adjacent — multi-video synthesis | Different job: synthesizes across many videos into one themed report with cross-video citation, not single-video deep-dive. $6.99/mo or one-time packs, 50 free credits, 16 output languages. Closest thing found to a "knowledge-graph-across-videos" positioning, though it's synthesis-across-corpus not within-video entity/relation graphing. |
| **YouTLDR** | Direct | $9.50/mo, claims 125+ languages (highest language claim found in this pass — unverified beyond the vendor's own comparison table, which is a low-trust self-authored source), content-repurposing exports (blog/LinkedIn/Twitter/PowerPoint) not seen elsewhere. |
| **Recall** | Adjacent (PKM/knowledge management) | Already flagged in merged doc's refund-policy research (30-day refund, abuse-clawback). Positioned as "connected knowledge graph" tool — closest *named* competitor claiming graph/KG language, worth a direct feature check if pricing decision hinges on KG differentiation. |
| **Monica AI** | Adjacent (broad AI suite) | YouTube summarization is one feature of a general AI assistant, 50+ languages claimed, $10-20/mo. Diffuse competitor, not YouTube-native. |
| **Fireflies / Tinrec / BibiGPT / Decopy AI / iWeaver / TubeOnAI / Memories.ai / Noverload / Rezoum / Dechecker / mindmapai.app / SummaryWorld** | Direct/adjacent, long tail | Named across sources but not independently deep-dived here — mostly repeat the same $5-15/mo clustering already established in the merged doc's 66-competitor pattern. No new pricing-band or refund-policy information found that changes the merged doc's conclusions. |

**No competitor found in this pass claims an 11-dimension structured analysis output.** The deepest feature claims found are: NoteGPT (mind maps + flashcards, multi-format), Recall (connected knowledge graph — name-level claim only, feature depth not independently verified here), Tube-U (multi-video synthesis with citations). Every other competitor tops out at single-pass bullet/key-point summarization, regardless of price tier.

---

## 2. Depth-of-analysis comparison table

| Product | Entry paid price | What's actually delivered (verified, not marketing copy) | KG/mind-map | Chat/Q&A | Languages (claimed) | Export | Refund |
|---|---|---|---|---|---|---|---|
| **Eightify** | ~$8-10/mo ($60-120/yr); no public one-time option; App Store lists $9.99/mo or $59.99/yr | Fixed 8-bullet-point key-point summary per video, timestamped. No multi-dimension breakdown. Own `/pricing` page returns 404 — pricing only verifiable via App Store listing (a real, flagged transparency gap). | No | No | 40+ (unverified beyond vendor claim) | No | No stated refund policy found; App Store reviews report cancellation friction and surprise annual billing (see §3) |
| **NoteGPT** | $9-19.99/mo depending on tier; Pro $9/mo annual, Unlimited $19.92/mo annual, Max $69/mo annual | Summary + mind map + flashcards + timestamped notes. Batch mode = N separate per-video summaries, not synthesis. Multi-format (PDF/slides) beyond video. | Yes (mind map, single-video) | No (not found in any source) | ~20-60+ (sources disagree: 20-30 vs 60+) | Some (Notion/Obsidian/Readwise workflow integration) | Quotas persist even on paid tiers (a real complaint pattern, not just free-tier limiting) |
| **Glasp** | Free | Public highlight-based summary, multi-LLM backend requiring user's own API key for some features | No | No | ~20 | Limited | Explicitly non-refundable (N/A — free) |
| **Summarize.tech** | Free | Single paragraph-style summary, no structure beyond that | No | No | English mainly | No | N/A (free) |
| **Recall** | ~$10/mo | Positioned as connected-knowledge-management tool; KG claim is name-level, not independently feature-verified in this pass | Claimed | Not confirmed | 15-20 | Not confirmed | 30-day, new-users-only, abuse-clawback clause (confirmed in prior merged research) |
| **YT Summarizer** | $9-$49 one-time (no subscription) | Single-video key-point summary, no dimension breakdown found | No | No | Not confirmed | Not confirmed | Not confirmed |
| **Tube-U** | $6.99/mo or one-time $4.99-$14.99 packs | Multi-video synthesis report with theme organization + inline timestamp citation across sources — structurally the most "multi-dimension" competitor found, but the dimension is "across videos," not "within one video" | No (synthesis report, not graph) | Not confirmed | 16 output languages | Not confirmed | Not confirmed |
| **Notta** | ~$8.17/mo annual | Transcript + AI summary, meeting/recording-first, minute-capped | No | No | 58 (real, cross-referenced twice) | Not confirmed | Not confirmed for YouTube use case specifically |
| **NotebookLM** | Free (50-source tier) | Cross-source research notes/briefing/chat — genuinely has chat, but positioned for multi-document research, not single-video deep analysis | No | **Yes** — the only tool in this table with confirmed real chat/Q&A | N/A (Google-scale, not separately marketed) | Notes export | N/A (free) |
| **hex-yt-intel (real, own product)** | Free / Light $5-7/mo / Pro $9-15/mo / Max (higher, TBD) — candidate pricing, not finalized | **Free/Light**: single-analysis or digest-only compute path (pending internal §6.0 resolution of whether this is genuinely lighter-weight). **Pro/Max**: full **11-dimension UCIS** structured breakdown + Dimension 8 real **Knowledge Graph data** (populates WordCloud/MindMap/KnowledgeGraphCanvas) + Dimension 0 executive digest, real-tested across **65+ languages** | **Yes, real** — the only product in this table with a genuine structured knowledge graph populated from LLM-extracted entities/relations, not a name-level claim | **Yes, real** — chat grounded in the analysis (ADR 008/009), with cascade escalation design | 65+ (real-tested, per project claim — not vendor marketing copy) | Not confirmed as a current shipped feature | No refund policy currently in place (per pricing-economics doc's framing — an open decision, not yet resolved) |

**Caveat on hex-yt-intel's own row**: this is drawn from the project's own internal design doc (`PRICING_ECONOMICS_MASTER_MODEL.md` §2), which itself flags the Free/Light tier's actual compute depth (digest-only vs. full-UCIS) as still an **open, unresolved question (§6.0)** — the row above states this explicitly rather than asserting a settled feature set for those tiers. Only Pro/Max are described with confidence as "full UCIS," per that doc.

---

## 3. Real user-reported sentiment (not vendor marketing)

**Eightify** — highest signal found, multiple independent sources agree on the same fault lines:
- **Chrome Web Store**: 4.02/5 across 852 ratings, but the *last 100* reviews average 4.21 — recent sentiment trending up (tooltivity.com's independent re-aggregation, 2026-07-22).
- **App Store reviews** (apple.com, pulled directly, 2026-01): recurring complaints are billing/subscription related, not summary quality — "cancelled the subscription 3 times and it kept coming back... eventually got me for 65 dollars," a "predatory trial" complaint describing a $1 trial converting to $150/year in small print, and a no-history/no-persistence complaint ("I regret paying for an app that provides a transcript but once you leave that page it's gone").
- **rightaichoice.com's structured community scan** (27 mentions across Hacker News/Product Hunt/Bluesky/Lemmy, researched 2026-07-03): "Summaries can be inaccurate or miss context for complex videos," "No way to customize summary length," "Only supports YouTube."
- **Reddit-specific aggregation** (blog.ytsummarizer.app, itself a competitor's blog — read with appropriate skepticism, but the pattern is corroborated independently by the App Store/community-scan sources above): "mixed" sentiment, extension UX gets "universal praise," backlash consistently centers on the 3-summaries/week free cap and subscription fatigue, not output quality.
- **Net read**: Eightify's real complaint cluster is **billing/UX friction and free-tier stinginess**, not analysis depth or accuracy — a different competitive vulnerability than "shallow analysis," worth noting since it means competing purely on depth may not address what actually drives Eightify's negative sentiment.

**NoteGPT** — thinner independent sentiment data found in this pass; recurring theme across vendor-adjacent comparison sites (converging independently, moderate trust) is that quotas persist even after paying, which reads as a genuine differentiator-in-reverse against hex-yt-intel's compound-quota model (§3 of the pricing doc) — NoteGPT users report hitting caps *while already paying*, a sharper complaint than "there's a free-tier cap."

**No G2/Trustpilot-specific reviews were surfaced in this pass** for either Eightify or NoteGPT despite targeted queries — this category (consumer browser-extension tools, not B2B seat-licensed SaaS) appears to under-index on G2/Trustpilot, which lean toward B2B software; App Store, Chrome Web Store, Reddit, and Hacker News/Product Hunt are the real sentiment venues for this specific niche. Flagging this as a genuine finding (where the sentiment actually lives), not a research gap.

---

## 4. Positioning analysis: is the $5-10/mo band still undifferentiated?

**Short answer: largely yes on price clustering (confirmed, matches the 2026-08-16 merged doc's finding), but a real depth split exists that the price clustering obscures.**

Evidence for continued price-band convergence: Eightify ($8-10), NoteGPT (Pro $9), YouTLDR ($9.50), Recall (~$10), Mindgrasp ($10-15 in this pass) all still cluster in the same narrow band the merged doc already established across 66 competitors. Nothing found in this expanded pass moves that headline finding.

**But real depth is NOT uniform within that band** — three tiers of actual delivered depth emerged from this pass:

1. **Single-pass bullet/key-point only** (Eightify, Summarize.tech, YT Summarizer, most of the long tail) — no structured multi-dimension breakdown, no KG, generally no chat.
2. **Summary + supplementary study artifacts** (NoteGPT: mind map + flashcards; single-video mind maps, not cross-entity knowledge graphs) — priced the same as tier 1, despite more surface features.
3. **Cross-video or knowledge-graph-adjacent** (Tube-U: multi-video synthesis; Recall: KG-branded but unverified depth) — a genuinely different job-to-be-done, not really a competitor on "analyze this one video deeply."

**No competitor found in this pass matches hex-yt-intel's actual claimed depth** — an 11-dimension structured UCIS breakdown plus a real entity/relation knowledge graph populated from the analysis itself (not a supplementary mind-map feature) plus grounded chat, at a price point that (per the pricing-economics doc's own Pro tier, $9-15/mo) sits in the *same* $5-15 band as competitors offering only tier-1 or tier-2 depth above.

**Two real positioning options this evidence supports, presented for the Council to weigh, not decided here**:
- **(a) Cheap-for-shallow-value**: match the $5-10 entry price with the Light tier's digest-only path, competing directly against Eightify/YT Summarizer on price with comparable (not deeper) depth — viable since entry-tier competitors have real friction (Eightify's billing complaints, NoteGPT's paid-tier quota complaints) that a cleaner UX could exploit without needing deeper features to win.
- **(b) Premium-for-real-depth**: price Pro/Max meaningfully above the $5-10 cluster (the pricing doc's own $9-15 Pro estimate already sits at the top edge, and Max is undetermined-higher) on the argument that no competitor in this pass delivers comparable structured depth (11-dimension + real KG + grounded chat) at any price point found — the market segment for "deep single-video analysis with a real knowledge graph" is currently **empty**, not merely underpriced, which is a different and stronger claim than "everyone charges $5-10 so we should too."

The evidence more clearly supports (b) as the differentiated claim being real (no depth-matched competitor exists), while (a) remains viable specifically as an entry-funnel tier rather than the primary value proposition — consistent with the pricing doc's own Free/Light-vs-Pro/Max split, not a contradiction of it.

---

## 5. Greg Isenberg pricing-elasticity reference — search result, not fabricated

**The specific story as described by the user (a company that repeatedly changed price up and down until roughly doubling it while performing better) was NOT found as a directly-attributed Isenberg citation in this search pass.** Reporting what was actually found instead of forcing a match:

1. **Real, verified Isenberg tweet on pricing philosophy** (not a "doubled the price" case study, but directly on-topic for the Council's pricing-elasticity question): [x.com/gregisenberg/status/1977884026821059048](https://x.com/gregisenberg/status/1977884026821059048) — "most founders pick a price on day 1 and never touch it again... price stays at $49. that's insane. your product on day one and your product 12 months later aren't the same thing. why should they cost the same? value compounds. price should too." This is a real, citable data point on the *general principle* the user described (pricing should move as value compounds), attributed correctly to Isenberg, but it is a philosophy statement, not a specific named-company doubling story.

2. **Closest real specific case studies found (not attributed to Isenberg specifically, but structurally matching "raised price, performed better")**:
   - **CartHook (Jordan Gal)**: tripled price $100→$300, then raised again to $500 + 0.5% transaction fee, including on existing customers — monthly churn dropped 15%→2%, MRR doubled $250K→$500K in one year. (Source: SaaS Club podcast, saasclub.io/podcast/jordan-gal-rally.) This is one-directional (up, not "up and down"), not a doubling exactly, and not an Isenberg-hosted interview.
   - **Unbounce (Rick Perreault)**: eliminated $10/$25 plans, average revenue per customer rose $30→$80 (a 2.67x increase, closer to "roughly doubled or more"), churn fell. (Source: SaaS Club podcast, saasclub.io/podcast/rick-perreault-unbounce.)

3. **Recommendation for the Council**: cite the verified Isenberg tweet (item 1) as the real, directly-attributed data point on the *elasticity/experimentation philosophy* the user wants represented — separate from a fixed "set once" approach — and cite CartHook/Unbounce (item 2) as real, independently-verified (non-Isenberg) case studies of the same underlying mechanism (raising price improved unit economics and retention, not just revenue), rather than presenting a fabricated single Isenberg case study that could not be verified. If the user has a more specific memory of the exact story (podcast episode name, guest name, or approximate quote), a follow-up targeted search could try again — this pass exhausted the direct-citation search paths available (X/Twitter search, podcast transcript search, general web search) without finding a closer match.

---

## Sources

Multi-engine: Exa (`web_search_exa`) + Brave (`brave_web_search`), per project standing rule. Key URLs cited inline above; full result sets retained in this session's tool-call history if further drill-down is needed.
