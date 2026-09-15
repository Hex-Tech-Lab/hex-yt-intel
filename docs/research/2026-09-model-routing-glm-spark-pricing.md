# Model-Routing Pricing Research: GLM 5.x (Z.ai) vs "Spark Muse" (actually Meta's Muse Spark) vs MiniMax

**Research date**: 2026-09-07 (all sources fetched live this date — nothing from training memory or prior session notes)
**Researcher**: OC (opencode, glm-5.3-flash), dispatched by CC
**Purpose**: fresh input for this repo's CLAUDE.md "Model/task-fit routing" table decisions
**Status**: research deliverable only — **no changes made to CLAUDE.md or any project file**. Recommendation section is for CC/user confirmation.

---

## 0. RCA — what was stale/wrong in prior session knowledge

| Prior belief | Verified reality (2026-09-07) |
|---|---|
| "Spark Muse"/"Muse Spark" = **MiniMax** product | **Wrong vendor.** Muse Spark is **Meta's** closed multimodal reasoning family (`meta/muse-spark-*` on OpenRouter; served from Meta Model API at `api.meta.ai/v1`). MiniMax's actual current lineup is **MiniMax-M3 / M2.7 / M2.7-highspeed** (M1/M2 legacy) — no "Muse" or "Spark" anywhere in MiniMax's official model catalog. [S1][S4][S5] |
| GLM-5.3-flash price quoted without promo context | Current $0.075/$0.25 is a **50% limited-time promotion ending 24:00 2026-09-09 (UTC+8)** — list price reverts to **$0.15/$0.50** after that. [S2] |
| GLM-5-Turbo treated as a current-tier option | **Not in Z.ai's current pricing page or docs index at all** (documented lineup: GLM-5.3, GLM-5.3-Flash, GLM-5.2). Still routable via OpenRouter (`z-ai/glm-5-turbo`). Treat as legacy. [S2][S3][S6] |
| GLM-5.3 generation age | GLM-5.3 added to OpenRouter 2026-08-18, GLM-5.3-Flash 2026-08-26 — both newer than the prior session's data. [S6] |

---

## 1. GLM 5.x family (Zhipu/Z.ai) — verified pricing

Vendor page: `https://docs.z.ai/guides/overview/pricing` (fetched 2026-09-07) [S2]
Cross-check: OpenRouter live API `https://openrouter.ai/api/v1/models` (fetched 2026-09-07) [S6]

### 1.1 Price table (USD per 1M tokens)

| Model | Z.ai official in / cached / out | OpenRouter in / cached / out | Context | Max output | Notes |
|---|---|---|---|---|---|
| **GLM-5.3** (flagship) | $1.40 / $0.26 / $4.40 | $1.40 / $0.26 / $4.40 ✓ exact match | 1M (Z.ai docs); OpenRouter lists 1,310,720 | 128K (Z.ai docs); OR lists 943,718 — see §6 flags | Text-only input. Reasoning **always on** (cannot disable). `reasoning_effort`: `low`/`high`/`max` (default `max`). [S2][S3][S6] |
| **GLM-5.3-Flash** | **Promo: $0.075 / $0.015 / $0.25** (list $0.15 / $0.03 / $0.50 — promo ends 2026-09-09 24:00 UTC+8) | $0.075 / $0.015 / $0.25 ✓ matches promo price | "1M" (Z.ai docs card); OpenRouter + codersera both list 1,310,720 | 128K (Z.ai); OR lists 131,072 | **Native multimodal** (text/image/video/file in). 320B total / 18B activated params, hybrid sparse+linear attention. Thinking forced on; recommended `reasoning_effort: max`. [S2][S4][S6] |
| GLM-5.2 | $1.40 / $0.26 / $4.40 | **$0.966 / $0.193 / $3.036** (cheaper than vendor) | 1,048,576 (OR) | 131,072 (OR) | Same base model as 5.3; 5.3 = post-training gains on top. [S2][S6] |
| GLM-5.1 | $1.40 / $0.26 / $4.40 | **$0.966 / $0.179 / $3.036** | 204,800 (OR) | 128,000 (OR) | [S2][S6] |
| **GLM-5** | $1.00 / $0.20 / $3.20 | **$0.60 / $0.12 / $1.92** (cheaper than vendor) | 204,800 (OR) | 128,000 (OR) | Superseded by 5.2/5.3 for new work. [S2][S6] |
| GLM-5-Turbo | **Not listed in current Z.ai pricing/docs** (legacy) | $1.20 / $0.24 / $4.00 (OR only) | 202,752 (OR) | 131,072 (OR) | Legacy; only verifiable via OpenRouter. Not recommended for new routing. [S2][S3][S6] |
| GLM-4.7-Flash / GLM-4.5-Flash | **Free** on Z.ai | — | 202,752 / — | 16,384 / — | Free tier; small max output. [S2][S6] |

### 1.2 Capability notes (vendor docs, fetched 2026-09-07)

- **GLM-5.3**: positioned for "complex software engineering and agent capabilities" and "long-horizon tasks"; same base as GLM-5.2 with post-training improvements (+50% on Z.ai Code Bench vs 5.2; Terminal-Bench 3.0: 4.6→28.3). Reasoning mandatory; three effort levels; forced `thinking.type: enabled` — requests with `disabled` **fail**. [S3]
- **GLM-5.3-Flash**: first native-multimodal GLM-5 model; vision built into the coding loop (screenshot→app, UI iteration); positioned as "stronger intelligence than GLM-5.2 at an exceptionally low cost"; Z.ai claims Artificial Analysis Intelligence Index v4.1.1 score 57 at ~$0.045/task. Z.ai notes it was anonymously tested as "ox-alpha" on OpenCode and OpenRouter before release. [S4]
- Aliases exist on OpenRouter: `~z-ai/glm-flash-latest` ($0.0713/$0.2375 — slightly below even the promo price) and `~z-ai/glm-latest` ($1.12/$3.52) — auto-pointer to newest in each tier. [S6]

---

## 2. "Muse Spark" — actually **Meta**, not MiniMax

OpenRouter model pages (fetched 2026-09-07) [S1]; codersera independent guide, 2026-09-03 (fetched 2026-09-07) [S5]; llm-stats.com listing [S7].
**Meta's own docs (developer.meta.com, dev.meta.ai) block direct fetches (HTTP 400/500) — their figures below are verified via OpenRouter + codersera's verbatim quotes of Meta's docs, not Meta's pages directly.**

### 2.1 Price table (USD per 1M tokens)

| Model | In / cached / out | Context | Max output | Released | Notes |
|---|---|---|---|---|---|
| **Muse Spark 1.3** (standard) | $1.25 / $0.15 / $4.25 | 1,048,576 | 943,718 (= 90% of ctx) | 2026-09-02 | Closed, API-only (`api.meta.ai/v1`; also on OpenRouter). Multimodal in: text/image/video/PDF + **audio (degraded in 1.3 — Meta says use 1.2 for audio)**. Reasoning mandatory; effort levels `minimal`/`low`/`medium`/`high`/`xhigh` (default `medium`). Tools + structured outputs. Prompts **not** used for training. Artificial Analysis Intelligence Index v4.1.1: **62, rank #6 of 636** (1.2 scored 57). [S1][S5] |
| **Muse Spark 1.3 Contributor** | **$0.10 / $0.002 / $0.20** | 1,048,576 | 943,718 | 2026-09-02 | Identical model specs. **12.5x cheaper in / 21.25x cheaper out / 75x cheaper cache — in exchange Meta trains on your prompts and completions.** Rate limits: 100 req/min vs 3,000 (standard); 3M tokens/min vs 4M. Selected purely by model-ID string. [S1][S5] |
| Muse Spark 1.2 | $1.25 / $0.15 / $4.25 | 1,048,576 | 943,718 | 2026-08-05 (contributor added 2026-08-21) | Audio fully supported (unlike 1.3). AA Index 57; LMArena text 1499±10 (rank 5). [S5][S6] |
| Muse Spark 1.1 | $1.25 / $4.25 | 1,048,576 | — | ~2026-07-09 (OR added 07-16) | First paid Muse Spark on Meta Model API. [S6][S7] |
| Muse Glimmer 30B (open-weights sibling) | $0.30 / $1.10 | 131,072 | 117,964 | 2026-08 | Apache 2.0, self-hostable — the open alternative in Meta's Muse line. [S6][S5] |

### 2.2 The Contributor-tier caveat (load-bearing for this repo)

codersera, quoting Meta's own pricing-and-rate-limits page verbatim: *"Heavily discounted token pricing in exchange for permission to use your prompts and completions to train future Meta models."* Standard tier: *"your prompts and completions are not used to train Meta models."* Meta does **not** document retention period, deletion rights, or whether tool-call arguments/attachments count as "prompts." [S5]

> **This collides directly with this repo's Rule #0 Confidentiality Protocol.** Route nothing confidential (repo code, strategic decisions, client material) through any `-contributor` SKU — the training grant is irreversible once absorbed into weights. If the contributor tier is used at all, restrict it to public/synthetic data (benchmarking, throwaway prototypes) and pin the model ID explicitly.

---

## 3. MiniMax — the actual family (what "Spark Muse" was NOT)

Vendor pages: `https://platform.minimax.io/` (models) + `https://platform.minimax.io/docs/guides/pricing-paygo.md` (fetched 2026-09-07) [S4b][S5b]
Cross-check: OpenRouter live API [S6]

### 3.1 Price table (USD per 1M tokens, pay-as-you-go)

| Model | MiniMax official in / cache-read / out | OpenRouter in / cached / out | Context | Max output | Notes |
|---|---|---|---|---|---|
| **MiniMax-M3** (≤512k input tokens) | **$0.30 / $0.06 / $1.20** (permanent 50% off; list $0.60/$0.12/$2.40) | $0.30 / $0.06 / $1.20 ✓ match (plus a `$0` `:free` variant) | 1,048,576 (official "1M"; OR confirms) | 512,000 (OR) | "Frontier multimodal coding model"; Anthropic-SDK-compatible API (also OpenAI + Responses formats). **Priority tier = 1.5x** (`service_tier: priority`). [S4b][S5b][S6] |
| **MiniMax-M3** (>512k input tokens) | **$0.60 / $0.12 / $2.40** (permanent 50% off) | — (OR shows single price) | 1,048,576 | 512,000 | Long-input surcharge: 2x once input exceeds 512k — relevant for this repo's long-transcript workloads. [S5b] |
| MiniMax-M2.7 | $0.30 / $0.06 / $1.20 | $0.30 / $0.06 / $1.20 ✓ | 204,800 (OR; official models page doesn't state ctx) | 131,072 (OR) | Current-gen non-M3; highspeed variant $0.60/$2.40. [S4b][S5b][S6] |
| MiniMax-M2.5 (legacy) | $0.30 / $0.03 / $1.20 | $0.27 / $0.027 / $1.08 | 204,800 | 128,000 | [S5b][S6] |
| MiniMax-M2 (legacy) | $0.30 / $0.03 / $1.20 | $0.255 / — / $1.02 | 200k (official) | 128k incl. CoT (official) | [S5b][S6] |

MiniMax sells no "Muse"/"Spark" product (their catalog: M3/M2.7 language, H3 video, speech-2.8 audio, music, image-01). [S4b]

---

## 4. Head-to-head comparison (all figures per 1M tokens, fetched 2026-09-07)

| Model | Provider | In $/M | Out $/M | Blended 3:1 $/M | Context | Max out | Notable capability differences | Sources |
|---|---|---|---|---|---|---|---|---|
| GLM-5.3 | Z.ai | 1.40 | 4.40 | 2.15 | 1M | 128K | Open-weight-family flagship; reasoning forced on (low/high/max); strongest coding/cyber claims; text-only | [S2][S3][S6] |
| GLM-5.3-Flash (promo) | Z.ai | 0.075 | 0.25 | 0.12 | 1M (OR: 1.31M) | 128K | Native multimodal; 320B/18B MoE; promo ends 2026-09-09 → list 0.15/0.50 (blended 0.24) | [S2][S4][S6] |
| GLM-5 (Z.ai list / OR) | Z.ai | 1.00 / 0.60 | 3.20 / 1.92 | 1.55 / 0.93 | 200K | 128K | Prior-gen; superseded | [S2][S6] |
| GLM-5-Turbo (legacy) | Z.ai via OR | 1.20 | 4.00 | 1.90 | 200K | 131K | Not in current Z.ai docs; skip | [S2][S6] |
| **Muse Spark 1.3** | Meta | 1.25 | 4.25 | 2.00 | 1.05M | 943K | Closed; AA Index 62 (#6/636); 5 reasoning-effort levels; 90%-of-ctx output; audio degraded in 1.3 | [S1][S5][S6] |
| **Muse Spark 1.3 Contributor** | Meta | 0.10 | 0.20 | 0.125 | 1.05M | 943K | Same model; **Meta trains on your data**; 100 RPM / 3M TPM caps | [S1][S5] |
| **MiniMax-M3** (≤512k in) | MiniMax | 0.30 | 1.20 | 0.53 | 1.05M | 512K | Frontier multimodal coding; Anthropic-compatible API; 2x price >512k input; free variant on OR | [S4b][S5b][S6] |
| MiniMax-M2.7 | MiniMax | 0.30 | 1.20 | 0.53 | 200K | 131K | + highspeed SKU at 2x | [S4b][S5b][S6] |

(Blended 3:1 = (3×in + 1×out)/4, same formula codersera uses for comparability [S5].)

---

## 5. Numbers I could NOT verify / open discrepancies

1. **Meta's own pages** — direct fetch blocked (HTTP 400 `developer.meta.com`, HTTP 500 `dev.meta.ai/docs/pricing-rate-limits`). Meta-official figures are known via OpenRouter's live catalog + codersera's verbatim quotes + llm-stats, i.e., **two+ independent secondary sources agree**, but I did not read Meta's primary docs myself. Treat Meta-direct confirmation as an open item.
2. **GLM-5-Turbo** — exists only in OpenRouter's catalog among my sources; not in Z.ai's current pricing/docs. Price therefore single-source (OpenRouter). Treat as legacy, do not build on it.
3. **GLM-5.3 max output** — Z.ai docs say 128K; OpenRouter lists 943,718 (suspiciously identical to muse-spark's 90%-of-ctx figure — likely an OpenRouter catalog artifact). Vendor number (128K) preferred until proven otherwise.
4. **GLM-5.3/Flash context** — Z.ai says "1M"; OpenRouter and codersera both list 1,310,720 (1.25M). Both plausible (vendor rounding down vs platform headroom); flag for an empirical probe if context limits matter to a task.
5. **OpenRouter-below-vendor prices** on GLM-5.2/5.1/5 ($0.966 vs $1.40 etc.) — both fetched live today; OpenRouter is genuinely cheaper than Z.ai list for those SKUs. Reason undocumented; when routing via OpenRouter, expect the OR price; when hitting `api.z.ai` directly, expect the vendor price.
6. **GLM cached-input storage fee** — Z.ai lists it as "Limited-time Free"; a future storage charge may appear. Re-check before relying on heavy caching.
7. **Muse Spark 1.3 LMArena rating** — not yet available (1.2: 1499±10, rank 5). 1.3's quality claim rests on AA Index 62 + Meta prose ("performs competitively with frontier models"); Meta publishes no numeric benchmark table itself. [S5]

---

## 6. Routing recommendation (for CC/user confirmation — NOT implemented)

Mapped against the existing CLAUDE.md "Model/task-fit routing" table:

| Candidate | Fits which row | Recommendation |
|---|---|---|
| **GLM-5.3-Flash** | "Well-scoped, narrow investigation+fix → OC on cheap default" | **Already in-row** — it *is* OC's current model. Keep. Set `reasoning_effort: low` for cheap dispatches (thinking cannot be disabled, but effort is tunable). **Action item: after 2026-09-09 the promo expires → cost doubles to $0.15/$0.50.** Still cheapest credible reasoning model in this comparison; no change needed, but re-check the row's economics after the 9th. |
| **GLM-5.3 (non-flash)** | "Multi-hop or long-horizon reasoning" | **Candidate, unproven.** Vendor positioning is literally "complex programming and long-horizon tasks"; 1M ctx; always-on reasoning with effort control; $1.40/$4.40 is mid-market (≈1/3 of Claude Opus 5's $5/$25). Consistent with the routing table's own principle that Flash-tier models underperform multi-hop work — 5.3 is the non-Flash upgrade path *within the already-proven GLM family*. Requires a real fidelity test on a repo task before displacing any proven row (per the table's own decay caveat and §5.0.1's 10x rule). |
| **Muse Spark 1.3 (Meta)** | "Multi-hop or long-horizon reasoning" | **Candidate with two hard gates.** (a) Standard tier only — **the Contributor tier is categorically excluded for any confidential work** (Rule #0; Meta trains on it, and the grant is irreversible). (b) Strongest independent signal in this comparison (AA 62, #6/636, beating every model priced below Claude-tier) + 943K max output suits long-agent loops — but zero LMArena rating, thin vendor benchmarks, and 1.3's audio regression. Verify on a real multi-hop repo task before adopting; also note it adds a 4th vendor relationship (or stays behind OpenRouter). |
| **Muse Spark 1.x Contributor** | none | **Do not route repo work through it.** Acceptable only for public/synthetic-data benchmarking or throwaway prototypes, with the model ID pinned and excluded from production config. |
| **MiniMax-M3** | Cheap-tier row / experiments | **Interesting, not urgent.** At $0.30/$1.20 it undercuts GLM-5.3-Flash's *post-promo* list price only on the output token (1.20 vs 0.50) but loses on input (0.30 vs 0.15); blended 0.53 vs 0.24. Its differentiators: 512K max output (huge for long-form generation), Anthropic-API-compatible endpoint, and a **$0 free variant on OpenRouter** — that free tier is worth using for evals/experiments. Watch the >512k-input 2x surcharge for long-transcript workloads. M2.7 is a non-event at the same price with less context. |
| **GLM-5 / GLM-5-Turbo** | none | Superseded/legacy; skip both. |

**Net suggested changes to the routing table (pending confirmation):**
1. No immediate change — GLM-5.3-Flash already occupies the cheap-tier row correctly.
2. Calendar check after 2026-09-09: confirm GLM-5.3-Flash promo expiry and re-cost the cheap-tier row (blended goes $0.12 → $0.24/M; MiniMax-M3's free OpenRouter variant is the fallback experiment lane).
3. Pilot GLM-5.3 (effort `high`) and Muse Spark 1.3 (standard only) on one real multi-hop repo task each; adopt whichever wins the fidelity/cost ratio. Neither touches CLAUDE.md until empirically verified.

---

## 7. Sources (all fetched 2026-09-07)

| # | Source | URL | Fetched (UTC) |
|---|---|---|---|
| S1 | OpenRouter — Muse Spark 1.3 + 1.3-contributor model pages | `https://openrouter.ai/meta/muse-spark-1.3`, `https://openrouter.ai/meta/muse-spark-1.3-contributor` | 14:4x |
| S2 | Z.ai official pricing | `https://docs.z.ai/guides/overview/pricing` | 14:3x |
| S3 | Z.ai GLM-5.3 model doc + migration guide | `https://docs.z.ai/guides/llm/glm-5.3.md`, `https://docs.z.ai/guides/overview/migrate-to-glm-new.md` | 14:3x |
| S4 | Z.ai GLM-5.3-Flash model doc | `https://docs.z.ai/guides/vlm/glm-5.3-flash.md` | 14:3x |
| S4b | MiniMax official models overview | `https://platform.minimax.io/` | 14:3x |
| S5 | codersera — Muse Spark 1.3 guide (2026-09-03, quotes Meta docs verbatim) | `https://codersera.com/blog/muse-spark-1-3-complete-guide-2026/` | 15:0x |
| S5b | MiniMax official pay-as-you-go pricing | `https://platform.minimax.io/docs/guides/pricing-paygo.md` | 14:5x |
| S6 | OpenRouter live models API (full catalog JSON, 430 models) | `https://openrouter.ai/api/v1/models` | 14:3x |
| S7 | llm-stats — Muse Spark 1.3 listing (search snippet) | `https://llm-stats.com/models/muse-spark-1.3` | 14:5x |

---

*Report ends. No repo files other than this document were created or modified. Ledger updated to [DONE].*
