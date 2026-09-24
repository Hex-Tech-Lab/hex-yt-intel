# Business Case: COGS, Pricing & Competitors

## 1. Thesis & Headline Recommendation
**Recommendation:** Implement a tier structure of $9/mo (Light) and $15/mo (Pro) with a 30/100 video quota, using `gpt-4o-mini` for draft passes and `claude-haiku-4.5` for refinement. 

The previous "Product Map Chairman" assessment that "$5/15 and $9/60 lose money at full use" was based on an outdated $0.34/analysis COGS (likely assuming Opus or uncached GPT-4). Rebuilding the model with today's `gpt-4o-mini` and `claude-haiku-4.5` via OpenRouter brings blended API costs to **~$0.02 - $0.03 per analysis**. At a 100-video quota for a $15/mo Pro plan, maximum variable COGS is ~$3.50, ensuring a structural gross margin of >75% even at 100% utilization. 

Founder presale options should anchor higher: **$79 lifetime for Light, $149 lifetime for Pro**, capped at 500 seats to inject initial cash flow to cover fixed infrastructure costs while building the compounding retention loop.

## 2. Unit Economics & COGS Model

### 2.1 Inputs (MEASURED via OpenRouter / SOURCED)
* **LLM Pricing (OpenRouter)**:
  * `openai/gpt-4o-mini`: $0.15 / 1M input, $0.60 / 1M output
  * `anthropic/claude-haiku-4.5`: $1.00 / 1M input, $5.00 / 1M output
* **Transcript Pricing**: Apify YouTube Scraper (~$0.001 / video) / free via TranscriptAPI.
* **Tokens (ASSUMED from transcript density)**: ~200 tokens per minute of video + 1000 tokens system prompt. 1,500 output tokens per full analysis (10 dimensions).

### 2.2 COGS per Video Length Band (Haiku-4.5 Full Cascade)
*Assuming 100% Haiku-4.5 processing (worst-case cost) and zero input caching.*

| Length | Input Tokens (est) | Output Tokens | LLM Cost ($) | Transcript Cost | **Total COGS / Video** |
|--------|-------------------|---------------|--------------|-----------------|-------------------------|
| 10 min | 3,000             | 1,500         | $0.0105      | $0.001          | **$0.0115**             |
| 30 min | 7,000             | 1,500         | $0.0145      | $0.001          | **$0.0155**             |
| 60 min | 13,000            | 1,500         | $0.0205      | $0.001          | **$0.0215**             |
| 120 min| 25,000            | 1,500         | $0.0325      | $0.001          | **$0.0335**             |

*Blended Average Cost (assuming 50% 10-min, 30% 30-min, 20% 60-min)*: **$0.015 per analysis**

### 2.3 Optimization Levers
1. **GPT-4o-mini Draft + Haiku Refine**: Slashes input reading costs by 85%. A 60-min video input on 4o-mini costs $0.0019 (instead of $0.013 on Haiku).
2. **Digest-Only Light Path**: For free tiers, generating a 500-token summary instead of a 1500-token 10-dimension array drops output cost by 66%.
3. **Prompt Caching**: If users analyze the same video multiple times, Haiku input cache ($0.10 / 1M) drops input cost by 90%.

### 2.4 Fixed Infrastructure Costs
* **Cloudflare Workers Paid**: $5/mo + CPU
* **Vercel Pro**: $20/mo
* **Supabase Pro**: $25/mo
* **Upstash**: ~$10/mo
* **Sentry**: $29/mo
* **Total Fixed**: ~$89/mo (Requires ~10 paid Pro users to break even on fixed ops).

---

## 3. Competitive Landscape (Pricing & Quotas)

Research was executed multi-engine across Exa, Brave Search, and Decodo using the `run-pricing-research.ts` harness.

| Competitor | Plan Name / Best For | Price / Mo | Quotas / Limits | Depth / Notes |
|------------|----------------------|------------|-----------------|---------------|
| **Eightify** | Premium | $4.99 - $9.99 | Unlimited summaries | Limits free to 3 videos/week (<30min). Premium allows videos >10h. |
| **NoteGPT** | Pro / Note-taking | $2.99 - $15.00| Unknown | Cheapest paid entry ($2.99). Extensive free tier with mind maps. |
| **YouTLDR** | Pro | $12.00 | Unknown | Chat, library, multi-language. Strong overall feature set. |
| **Glasp** | Pro / Social | Free / $12.00 | Unknown | Extension required. Focus on social highlighting and quotes. |
| **Summarize.tech** | Pro | $5.00 / $4.95| Unlimited | Text-heavy, basic gist, no chat/library features. |
| **Recall** | Pro | $10.00 | Unknown | Focus on long-term knowledge management and categorization. |
| **Notta** | Pro / Transcription | $14.00 | Unknown | Heavy focus on meeting transcription (58 languages), not just YT. |

**Synthesis**: The market floor is $3-$5/month for basic unconstrained usage. The ceiling is $12-$15/month for robust library, chat, and knowledge-management features. The "visual auto-scrubber" and "grounded claim verification" remain our primary differentiator to justify the $9-$15 price point.

---

## 4. Break-even & Margins

At a $15/month Pro tier, assuming a conservative blended COGS of **$0.02** per analysis:
* **25% utilization (25 videos/mo)**: $0.50 variable cost. Gross Margin = 96.6%.
* **50% utilization (50 videos/mo)**: $1.00 variable cost. Gross Margin = 93.3%.
* **100% utilization (100 videos/mo)**: $2.00 variable cost. Gross Margin = 86.6%.

The prior threat of "losing money at full use" is completely mitigated by the precipitous drop in frontier model costs (GPT-4o-mini and Haiku 4.5 vs Opus/GPT-4).

### Founder Pool Options
* **$49 / $99 pool**: Too cheap. It sets a low psychological anchor and leaves cash on the table given the $150/yr willingness-to-pay identified in previous persona research.
* **$79 / $149 pool**: Recommended. 250 spots at $149 = $37,250 immediate cash infusion, enough to fund CAC experiments and 2 years of fixed infra costs.

### What to Decide Now vs. Post-Launch
* **Decide Now**: The price point ($9 Light / $15 Pro) and the usage quotas (30 / 100). Implement the `gpt-4o-mini` draft pass to lock in the 86%+ margin.
* **Decide Later**: Churn countermeasures. If the 10.5% monthly churn benchmark holds true, we will need to pivot aggressive development into automated email digests and scheduled competitor monitoring to retain users. 

---

## 5. Uncertainties / Risks
1. **CAC Efficiency**: We have an assumed LTV of ~$134, but no measured CAC. If creator-sponsorships cost >$40 per acquired user, the unit economics become strained.
2. **True Video Length Distribution**: If the beachhead persona strictly analyzes 3-hour podcasts rather than 30-minute tutorials, blended COGS will drift toward $0.04/analysis.
3. **API Rate Limits & Stability**: Reliance on OpenRouter + Apify for scraping introduces multi-vendor uptime risk, especially for a high-availability visual scrubber tool.

## Sources Table
* Pricing scraped via `scripts/research/run-pricing-research.ts` on 2026-09-25.
* LLM costs pulled from OpenRouter API on 2026-09-25.
* Prior insights referenced from `.memory/` and `docs/private/` study docs (August 2026).
