# ADR 043: Chat Intent Routing (Jev) & Prompt-Injection Screen (Llama Prompt Guard 2 on Groq)

**Status:** Proposed
**Date:** 2026-10-13
**Context:** Two chat-path gaps surfaced in the 2026-10-13 UAT wave (item T3):

1. **Misrouted chat turns.** Follow-ups such as "make it more elaborate" fell from Haiku 5.5 to OpenRouter OSS-120B (about 2.5x cost on the same turn). Blog-style requests showed the "Expand to full comments" chip. Blog output contained timestamps the user did not ask for. The cascade chooses a model and a response shape without a dedicated intent signal, so the same chat surface serves writing, comment lookup, citation lookup, and metadata questions through one path.
2. **No prompt-security screen before the chat model.** Chat input (user text, and transcript text folded into context) reaches the generation model unscreened. Prompt-injection and jailbreak attempts from pasted transcript content or user messages are not classified before generation.

Jev (`typesafe/jev-latest` via the OpenRouter Decisions API, already used for analysis classification in ADR 036 Layer 0 and the ADR 038 cascade) is an existing dependency and already produces typed classifications with a per-call cost of roughly $0.00001. It is the natural intent router. Llama Prompt Guard 2 is a small, purpose-built classifier that can run as a pre-generation screen at low latency.

### Verified Groq limits and pricing (checked 2026-10-13)

Sources:
- Llama Prompt Guard 2 22M model page: https://console.groq.com/docs/model/meta-llama/llama-prompt-guard-2-22m
- Llama Prompt Guard 2 86M model page: https://console.groq.com/docs/model/meta-llama/llama-prompt-guard-2-86m
- Rate limits page: https://console.groq.com/docs/rate-limits
- Groq pricing page (https://groq.com/pricing) redirected to the marketing home page at check time and did not expose a price table. Per-model prices below come from the model pages instead.

| Model | Input price | Output price | Context window | Max output tokens | Base RPM | Base RPD | Base TPM | Base TPD | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `meta-llama/llama-prompt-guard-2-22m` | $0.03 per 33M tokens | $0.03 per 33M tokens | 512 | 512 | 30 | 14.4K | 15K | 500K | English jailbreak AUC 99.5%; recall 88.7% at 1% FPR; optimised for English |
| `meta-llama/llama-prompt-guard-2-86m` | $0.04 per 25M tokens | $0.04 per 25M tokens | 512 | 512 | 30 | 14.4K | 15K | 500K | English jailbreak AUC 99.8%; recall 97.5% at 1% FPR; 8 languages |

The rate-limit page states these are the Developer-plan base limits; the exact limits for our organisation live on the Groq Limits page in account settings and must be checked before rollout. Cached tokens do not count toward rate limits. 429 responses carry `retry-after`.

Implications:
- A 512-token context window means each chat input must be segmented (or truncated with an explicit policy) before screening. The model card recommends segmenting longer inputs and scanning segments in parallel.
- At the base TPM of 15K, a 46-65k-token chat turn screened in full would take roughly 3-4 minutes of minute-quota per turn. At the base TPD of 500K, full-context screening would exhaust the daily token budget after roughly 8-10 turns. Screening must therefore target user-authored text and the newest turn, not the full retrieved transcript context. This is a design constraint, not a blocker.
- Price is negligible at these rates. The constraints are TPM/TPD quota and latency, not cost.

### Decisions (proposed)

**A. Jev as chat intent router.**
1. Jev classifies every chat turn into one intent from a closed set: `writing` (blog, post, rewrite, elaborate), `comments_lookup`, `citation_lookup`, `metadata`, `general_grounded_qa`. The label set is a versioned constant, not free text.
2. The intent selects the response contract. `writing` never receives the comments-expansion chip and never receives timestamp rules unless the user asked for timestamps. Chip triggers read the intent label, not keyword matches on the message.
3. Follow-up turns inherit the prior turn's intent unless Jev returns a confident override. Model-tier choice for `writing` follow-ups stays on the chat cascade's primary tier. Downgrade to a cheaper tier requires an explicit intent that permits it.
4. Each classification is logged with the label, confidence, and Jev version, so misroutes are measurable.
5. Thresholds and the intent-to-model mapping live in the Settings Registry (`chat.intent.*`), not in code.

**B. Prompt Guard as a pre-generation screen.**
1. Screen only text the user authored in the current turn, including any user-pasted content. Retrieved analysis context is not screened per turn, because it is produced by our own pipeline. Transcript text folded into context is a known untrusted vector and is explicitly out of scope for this first rollout; it needs its own decision before `block` mode.
2. Use the 86M model by default because transcripts and users are multilingual (the 86M card lists 8 languages; the 22M card is optimised for English). The 22M model is a registry-selectable fallback for latency or quota pressure.
3. Segment inputs to 512 tokens with overlap, scan segments in parallel, and take the maximum attack score.
4. Action on a flag is a registry-controlled policy: `block` (refuse with a fixed message, log to Sentry), `flag` (proceed, tag the turn), or `off`. Initial rollout is `flag` only, to measure false-positive rate on real traffic before enabling `block`.
5. Screen failures (timeout, 429, 5xx) fail open with a logged `flag` and a Sentry event. Blocking the user on a classifier outage is rejected (see alternatives).
6. The Groq API key is a new secret and follows ADR 016's key-boundary and rotation policy.

**C. Sequencing.** Ship Jev intent routing (A) first because it fixes the observed T3 cost and misroute issues. Prompt Guard (B) ships behind `flag`-only mode after A is measured.

### Consequences

- A new external dependency (Groq) enters the chat path. Prompt Guard is synchronous and sits on the pre-generation critical path, adding its segment-scan latency to every turn. Failures fail open, so an outage degrades to unscreened chat rather than blocking it.
- Adds one Jev call per chat turn (about $0.00001) and one or more Prompt Guard calls per turn. Latency added on the critical path must be measured before default-on.
- The intent label set becomes a contract shared by the cascade, the chip logic, and the response contract. Changes to the set need a registry and test update in the same PR.
- The Groq rate limits above are base Developer-plan values. Real headroom must be confirmed on the account Limits page before `block` mode.
- Both Prompt Guard models (22M and 86M) are marked "Preview" on Groq, with no SLA. Availability and model behaviour can change without notice, which is one reason rollout starts in `flag` mode and why fail-open is required.

### Rollout gates (all required before `block` mode)

1. **Latency:** screening adds no more than 10% to baseline p95 time-to-first-token, measured on production-like chat traffic with and without screening.
2. **False positives:** review a sample of 1,000 benign chat turns. The false-positive rate must be at most 0.1% before `block` is enabled.
3. **Attack-score threshold:** a maximum attack-score threshold is defined and stored in the Settings Registry (`chat.promptGuard.maxAttackScore`). Value: `<TO FILL: owner>`.
4. **Risk acceptance:** the Security Owner and the Chat Product Owner sign off, acknowledging that transcript context stays unscreened under this ADR. Security Owner: `<TO FILL: owner>`. Chat Product Owner: `<TO FILL: owner>`. Date: `<TO FILL: owner>`.

### Open questions

- Whether Jev's Decisions API latency is acceptable on the chat critical path, or whether intent should run in parallel with retrieval.
- Exact Groq limits for our organisation (account Limits page, not public docs).
- Whether `writing` should bypass the grounding gate of ADR 008 when the user asks for an elaboration of an existing analysis. This ADR does not change ADR 008.

### Alternatives rejected

- **Keyword and regex intent routing.** This is the current behaviour that produced the T3 misroutes. Rejected.
- **Prompt Guard as a blocking gate on all context, including retrieved transcript.** Would exceed the 512-token window many times per turn and the base TPM quota on every turn. Rejected.
- **Fail-closed screening.** A classifier outage would block all chat. Rejected in favour of fail-open with logging.
- **Using the generation model itself as the injection classifier.** Same model that is being attacked, no separate measurement, higher cost. Rejected.

### References

- ADR 008 (chat grounding gate), ADR 011 (model routing), ADR 016 (external key boundary), ADR 036 (Jev Layer 0), ADR 038 (analysis model cascade).
- Groq model pages and rate-limit page cited above (checked 2026-10-13).
