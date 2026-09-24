# Business Case: COGS, Pricing & Competitors

## 1. Thesis & Headline Recommendation
**Recommendation:** Implement a tier structure of $9/mo (Light) and $15/mo (Pro) with reduced quotas (e.g., 28 videos for Pro), using `nemotron-3-nano-30b` for draft passes and `claude-haiku-4.5` for refinement, as defined in the `worker/src` cascade config.

The previous "Product Map Chairman" assessment that "$5/15 and $9/60 lose money at full use" is actually **correct** when using real measured production data. Rebuilding the model with today's measured data brings blended API costs to **~$0.16 - $0.19 per analysis**. At a 60-video quota for a $9/mo Pro plan, maximum variable COGS is ~$11.22, resulting in a loss.

Founder presale options should anchor higher: **$79 lifetime for Light, $149 lifetime for Pro**, capped at 500 seats to inject initial cash flow to cover fixed infrastructure costs while building the compounding retention loop.

## 2. Unit Economics & COGS Model

### 2.1 Inputs (MEASURED from production data / ASSUMED)
* **LLM Pricing (OpenRouter)**:
  * `anthropic/claude-haiku-4.5` and `nemotron-3-nano-30b` cascade.
* **Analysis COGS (MEASURED)**: 
  * From `analysis_chunks.cost_usd` (41 analyses): **mean $0.153, p50 $0.160, p90 $0.187, max $0.206 per analysis**. 
  * Average tokens: ~88,400 tokens; 4.6 chunks avg.
* **Secondary Costs (ASSUMED)**: 
  * Digest, chat, and comment-classification costs: assumed $0.05 per analysis total (Service key missing to query `usage_logs` / `comment_classifications.cost_usd`).

### 2.2 COGS per Video (Blended)
* **p50 Cost**: $0.160 / analysis (Analysis) + $0.050 (Secondary) = **$0.210**
* **p90 Cost**: $0.187 / analysis (Analysis) + $0.050 (Secondary) = **$0.237**
*(Note: calculations below exclude the assumed secondary costs for strict LLM COGS evaluation based on p50 and p90 limits).*

### 2.4 Fixed Infrastructure Costs
* **Cloudflare Workers Paid**: $5/mo + CPU
* **Vercel Pro**: $20/mo
* **Supabase Pro**: $25/mo
* **Upstash**: ~$10/mo
* **Sentry**: $29/mo
* **Total Fixed**: ~$89/mo.

---

## 3. Competitive Landscape (Pricing & Quotas)

Research was executed multi-engine across Exa, Brave Search, Decodo, and Perplexity via `run-pricing-research.ts` harness on 2026-09-25.

| Competitor | Plan Name / Best For | Price / Mo | Quotas / Limits | Depth / Notes |
|------------|----------------------|------------|-----------------|---------------|
| **Eightify** | Premium | $4.99 - $9.99 | Unlimited summaries | Limits free to 3 videos/week (<30min). Premium allows videos >10h. |
| **NoteGPT** | Pro / Note-taking | $2.99 - $15.00| Not published | Cheapest paid entry ($2.99). Extensive free tier with mind maps. Checked NoteGPT pricing page. |
| **YouTLDR** | Pro | $12.00 | Not published | Chat, library, multi-language. Strong overall feature set. |
| **Glasp** | Pro / Social | Free / $12.00 | Not published | Extension required. Focus on social highlighting and quotes. Checked Glasp platform. |
| **Summarize.tech** | Pro | $5.00 / $4.95| Unlimited | Text-heavy, basic gist, no chat/library features. |
| **Recall** | Pro | $10.00 | Not published | Focus on long-term knowledge management and categorization. |
| **Notta** | Pro / Transcription | $14.00 | Not published | Heavy focus on meeting transcription (58 languages), not just YT. |
| **YouLearn** | Pro | $12.00 | Unlimited uploads/chats | Educational focus. Multi-model tiering. |
| **Tactiq** | Pro | $8.00 | Unlimited transcripts, 10 AI credits | Generous transcript tier, AI features gated per meeting. |
| **Merlin** | Pro | $19.00 | "Unlimited" (Invisible fair-use limits) | Shares credits across tools. Usage throttling. |

**Synthesis**: The market floor is $3-$5/month for basic unconstrained usage. The ceiling is $12-$19/month for robust library, chat, and knowledge-management features. The "visual auto-scrubber" and "grounded claim verification" remain our primary differentiator to justify the $9-$15 price point.

---

## 4. Break-even & Margins

### Tier Modeling (Light $5 for 15 videos, Pro $9 for 60 videos)
*Calculated using p50 ($0.160) and p90 ($0.187) COGS.*

#### Light Tier ($5/mo, 15 videos)
* **25% utilization (3.75 videos)**: 
  * p50 Cost: $0.60 (Margin: 88.0%)
  * p90 Cost: $0.70 (Margin: 86.0%)
* **50% utilization (7.5 videos)**: 
  * p50 Cost: $1.20 (Margin: 76.0%)
  * p90 Cost: $1.40 (Margin: 72.0%)
* **100% utilization (15 videos)**: 
  * p50 Cost: $2.40 (Margin: 52.0%)
  * p90 Cost: $2.80 (Margin: 44.0%)
**Result**: Light tier is profitable and achieves >70% margin at 50% utilization.

#### Pro Tier ($9/mo, 60 videos)
* **25% utilization (15 videos)**: 
  * p50 Cost: $2.40 (Margin: 73.3%)
  * p90 Cost: $2.80 (Margin: 68.8%)
* **50% utilization (30 videos)**: 
  * p50 Cost: $4.80 (Margin: 46.6%)
  * p90 Cost: $5.61 (Margin: 37.6%)
* **100% utilization (60 videos)**: 
  * p50 Cost: $9.60 (Loss: -$0.60)
  * p90 Cost: $11.22 (Loss: -$2.22)
**Result**: Pro tier **loses money** at 100% utilization and fails margin targets.

#### Rebalancing Pro Tier
To achieve ≥70% gross margin at 50% utilization and ≥0% margin at 100% utilization based on p90 COGS ($0.187):
* **Maximum Quota for $9/mo**: The quota must drop to **~28 videos/mo** (Cost at 100% = $5.23, Margin at 50% = 70.9%).
* **Minimum Price for 60 videos/mo**: The price must rise to **$18.70/mo** (Cost at 50% = $5.61, Margin at 50% = 70%).

### Founder Pool Options
Evaluating a pool of 300 analyses at p90 COGS ($0.187/analysis = $56.10 total cost):
* **$49 / $99 pool**: 
  * At $49, selling a 300-analysis pool incurs a loss of $7.10. 
  * At $99 (for say, a 600-analysis pool costing $112.20), it incurs a loss of $13.20. Too cheap.
* **$79 / $149 pool**: Recommended. 
  * At $79 (300 analyses), profit is $22.90 per seat. 
  * At $149 (say, 600 analyses), profit is $36.80 per seat. 
  Provides immediate cash infusion to fund CAC experiments.

### What to Decide Now vs. Post-Launch
* **Decide Now**: The price point and the usage quotas must be adjusted to prevent the Pro tier from losing money.
* **Decide Later**: Churn countermeasures. If the 10.5% monthly churn benchmark holds true, we will need to pivot aggressive development into automated email digests and scheduled competitor monitoring to retain users. 

---

## 5. Uncertainties / Risks
1. **CAC Efficiency**: We have an assumed LTV of ~$134, but no measured CAC. If creator-sponsorships cost >$40 per acquired user, the unit economics become strained.
2. **True Video Length Distribution**: If the beachhead persona strictly analyzes 3-hour podcasts rather than 30-minute tutorials, blended COGS will drift higher.
3. **API Rate Limits & Stability**: Reliance on OpenRouter + Apify for scraping introduces multi-vendor uptime risk, especially for a high-availability visual scrubber tool.

## Sources Table
* Pricing scraped via `scripts/research/run-pricing-research.ts` on 2026-09-25.
* LLM costs pulled from OpenRouter API on 2026-09-25.
* Prior insights referenced from `.memory/` and `docs/private/` study docs (August 2026).
