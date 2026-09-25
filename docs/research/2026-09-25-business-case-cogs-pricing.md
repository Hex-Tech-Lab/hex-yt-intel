# Business Case: COGS, Pricing & Competitors

## 1. Thesis & Headline Recommendation
**Recommendation:** Implement a tier structure of $9/mo (Light) and $15/mo (Pro) with reduced quotas (e.g., 28 videos for Pro), using `nemotron-3-nano-30b` for draft passes and `claude-haiku-4.5` for refinement, as defined in the `worker/src` cascade config.

The previous assessment that 60-video quotas lose money is correct. Rebuilding the model with measured data brings all-in costs to **~$0.21 - $0.26 per analysis** (including $0.05 secondary cost). At a 60-video quota for a $15/mo Pro plan, maximum variable COGS is ~$14.22.

Founder presale options should anchor higher: **$79 lifetime for Light (300 videos), $149 lifetime for Pro (600 videos)**.

## 2. Unit Economics & COGS Model

### 2.1 Inputs (MEASURED from production data / ASSUMED)
* **LLM Pricing (OpenRouter)**:
  * `anthropic/claude-haiku-4.5` and `nemotron-3-nano-30b` cascade.
* **Analysis COGS (MEASURED)**: 
  * September (current stack): 26 attempted, 16 completed, 20 incurred cost. 
  * **Input ≈ $0.096/analysis, output ≈ $0.09.** Total chunk cost = **~$0.187 (p90)**.
* **Secondary Costs (ASSUMED)**: 
  * Digest, chat, and comment-classification costs: assumed $0.05 per analysis total.

### 2.2 COGS per Video (Blended)
* **All-in average**: $0.21 per costed attempt, **$0.26 per successful analysis**.
* **p90 Cost (Analysis + Secondary)**: $0.187 + $0.050 = **$0.237 all-in**.
*(Note: calculations below include the $0.05 secondary costs for strict LLM COGS evaluation).*

### 2.4 Fixed Infrastructure Costs
* **Cloudflare Workers Paid**: $5/mo + CPU
* **Vercel Pro**: $20/mo
* **Supabase Pro**: $25/mo
* **Upstash**: ~$10/mo
* **Sentry**: $29/mo
* **Total Fixed**: ~$89/mo.
Break-even subscriber count required to cover fixed infrastructure: ~15 Pro subscribers at $15/mo (assuming 50% margin).

---

## 3. Competitive Landscape (Pricing & Quotas)

Research was executed multi-engine across Exa, Brave Search, Decodo, and Perplexity via `run-pricing-research.ts` harness on 2026-09-25. Output saved to `docs/research/pricing-results.json`.

| Competitor | Plan Name / Best For | Price / Mo | Quotas / Limits | Source |
|------------|----------------------|------------|-----------------|--------|
| **Eightify** | Premium | $4.99 - $9.99 | Unlimited summaries | eightify.app/pricing |
| **NoteGPT** | Pro / Note-taking | $2.99 - $15.00| Not published | notegpt.io/pricing |
| **YouTLDR** | Pro | $12.00 | Not published | youtldr.com/pricing |
| **Glasp** | Pro / Social | Free / $12.00 | Not published | glasp.co |
| **Summarize.tech** | Pro | $5.00 / $4.95| Unlimited | summarize.tech/premium |
| **Recall** | Pro | $10.00 | Not published | getrecall.ai/pricing |
| **Notta** | Pro / Transcription | $14.00 | Not published | notta.ai/pricing |
| **YouLearn** | Pro | $12.00 | Unlimited uploads/chats | youlearn.ai/pricing |
| **Tactiq** | Pro | $8.00 | Unlimited transcripts, 10 AI credits | tactiq.io/pricing |
| **Merlin** | Pro | $19.00 | "Unlimited" (Invisible fair-use limits) | getmerlin.in/pricing |

**Synthesis**: The market floor is $3-$5/month for basic unconstrained usage. The ceiling is $12-$19/month. Our $9-$15 price point is competitive.

---

## 4. Break-even & Margins

### Tier Modeling (Light $9 for 15 videos, Pro $15 for 28 videos)
*Calculated using all-in p90 COGS ($0.237).*

#### Light Tier ($9/mo, 15 videos)
* **50% utilization (7.5 videos)**: Cost = $1.78 (Margin: 80.2%)
* **100% utilization (15 videos)**: Cost = $3.56 (Margin: 60.4%)

#### Pro Tier ($15/mo, 28 videos)
* **50% utilization (14 videos)**: Cost = $3.32 (Margin: 77.9%)
* **100% utilization (28 videos)**: Cost = $6.64 (Margin: 55.8%)

*Note: At $9/mo & 28 videos, 50% use margin is 63.1% (Cost $3.32).*

### Founder Pool Options
Evaluating founder lifetime deals using all-in p90 COGS ($0.237/analysis):
* **$79 for 300 analyses**: Cost = $71.10. Profit = **$7.90 per seat**.
* **$149 for 600 analyses**: Cost = $142.20. Profit = **$6.80 per seat**.
Provides immediate cash infusion to fund CAC experiments and infrastructure, before fees/support.

### What to Decide Now vs. Post-Launch
* **Decide Now**: Set quotas to 15 (Light, $9) and 28 (Pro, $15) to maintain healthy margins.

---

## 5. Uncertainties / Risks
1. **CAC Efficiency**: We have an assumed LTV of ~$134, but no measured CAC. If creator-sponsorships cost >$40 per acquired user, the unit economics become strained.
2. **True Video Length Distribution**: If the beachhead persona strictly analyzes 3-hour podcasts rather than 30-minute tutorials, blended COGS will drift higher.
3. **API Rate Limits & Stability**: Reliance on OpenRouter + Apify for scraping introduces multi-vendor uptime risk.

## Sources Table
* Pricing scraped via `scripts/research/run-pricing-research.ts` on 2026-09-25.
* LLM costs pulled from OpenRouter API on 2026-09-25. Sample size: 41 chunks total, 26 attempted in September.
