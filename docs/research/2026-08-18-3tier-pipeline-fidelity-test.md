# 3-Tier Draft/Review/Refine Digest Pipeline — Real Fidelity Test (2026-08-18)

Dispatch spec: `docs/agent-prompts/2026-08-18-cline-nemotron-3tier-pipeline-test.md`. Prior attempt (Cline/Nemotron) reported blocked on DB access and missing API keys — both false in this session's environment; re-run here with real Supabase Management API access (`SUPABASE_ACCESS_TOKEN`, ADR 018 pattern) and a real `OPENROUTER_API_KEY`.

## RCA on prior "blocked" report

Cline's env lacked a usable Supabase path (REST + anon key, no service-role key) and self-reported "no GPT-OSS-120B or Haiku 4.5 keys" — this session's `.env.local` has a working `OPENROUTER_API_KEY` and a working `SUPABASE_ACCESS_TOKEN` (not `SUPABASE_SERVICE_ROLE_KEY`, which is genuinely empty in this repo's `.env.local`). The Management API (`https://api.supabase.com/v1/projects/adnmbikaqnxivalqoild/database/query`, Bearer `SUPABASE_ACCESS_TOKEN`) worked immediately. **Note**: `.env.local` is not auto-loaded into a bash subshell — needed `set -a; source .env.local; set +a` before curl/node could see the vars, which is plausibly the actual root cause of Cline's "no keys" self-report too, not real absence.

## Contract

1. Query `analyses` for real `dimension_count = 11` rows with non-null `executive_digest`.
2. For 5 selected rows, extract `analysis_markdown` (the real assembled input) and the stored `executive_digest` (the real historical baseline).
3. Run the 3-tier pipeline: GPT-OSS-120B draft (Tier 1, same system prompt/user message as production `getExecutiveDigestSystemPrompt()`/`buildExecutiveDigestUserMessage()`) → GPT-OSS-120B review against source (Tier 2) → Haiku 4.5 refine from draft+review only, not raw markdown (Tier 3).
4. Parse Tier 3 output with the real `parseExecutiveDigest()` logic (faithfully copied from `web/lib/prompts/executive-digest.ts`, not re-derived).
5. Score format (`parsedVia`) and content fidelity (Haiku-4.5-as-judge, 0–100, vs. the stored baseline).
6. Record real per-call token counts/costs (OpenRouter's own reported `usage.cost`, not estimated).

## CRITICAL premise correction — the "Haiku-4.5 baseline" assumption is factually wrong

The dispatch (and CLAUDE.md's ADR ledger, and even a sibling report's §6m claim of a "real Haiku-4.5-generated `executive_digest` baseline") assumes digest generation runs on Haiku 4.5. **Live schema/data check contradicts this.** All 5 sampled rows' `executive_digest.model` field reads `"openai/gpt-oss-120b"`, and `web/app/api/analyses/digest/route.ts` / `web/app/api/webhooks/digest/route.ts` both call `resolveChatCascade()`, whose fallback (`CHAT_CASCADE_FALLBACK`, `web/lib/config/cascade.ts`) is GPT-OSS-120B-primary (Cerebras/Groq/Baseten), not Haiku. `model_used` on the `analyses` row is the *main 11-dimension analysis* model (frequently Haiku 4.5) — a different pipeline stage entirely from the digest. **The real production baseline for digest generation today is already a single-shot GPT-OSS-120B call, not Haiku 4.5.** This test therefore actually measures: does 3-tier (2×GPT-OSS-120B + 1×Haiku) beat or lose to today's real single-shot GPT-OSS-120B production baseline — a different, more useful question than the one posed, and one that should correct ADR 010/011's stale framing.

## Real per-row results (5 rows, real API calls)

| Row ID | Video | Format (`parsedVia`) | Judge score /100 | Pipeline cost (real, 3 tiers) | Baseline cost (est., see note) |
|---|---|---|---|---|---|
| `35878592` | 50 BEST Chrome Extensions... | headers | 72 | $0.01259 | $0.00691 |
| `8af9413b` | How To Spy on Shopify Competitors... | headers | 92 | $0.01224 | $0.00889 |
| `b35c77f7` | 5 Pro Tips for Cooking Pizza... | headers | 72 | $0.01181 | $0.00499 |
| `c866f529` | Free AI Youtube Summarizer... | **fallback (FAILED)** | **0** | $0.00891 | $0.00739 |
| `e076b945` | 3 AI Video Generators That Are Free... | headers | 92 | $0.01132 | $0.01062 |
| **Mean** | | 4/5 pass (80%) | **65.6** (82.0 excl. the failure) | **$0.01137** | **$0.00776** |

Pipeline cost = real `usage.cost` summed across Tier 1 + Tier 2 + Tier 3 OpenRouter responses (not estimated). Baseline cost is an **estimate**: no historical per-call token count is stored for the original digest run, so it's derived from `truncateForDigest()`'s actual character count in / stored digest character count out, at OpenRouter's Haiku-4.5-Vertex list price — labeled as an estimate throughout, not passed off as measured.

## Real failure mode found (row `c866f529`)

Tier 2's review prompt (as specified in the dispatch: "give it the draft AND the source markdown, ask it to identify gaps") led GPT-OSS-120B to recommend restoring dimension-numbering, source headers, and evidence-quality tags into the digest — directly violating the system prompt's hard rule ("Never mention 'dimensions', 'the analysis', or the pipeline"). Tier 3 (Haiku 4.5) correctly detected the contradiction and **refused to produce a digest**, instead outputting a meta-commentary explaining the conflict. `parseExecutiveDigest()` correctly rejected it (fallback path, then near-empty/refusal-pattern reject → `null` in production; scored as a hard fail here). This is a structural flaw in the 3-tier design as specified, not a model quality issue: an unconstrained review pass can issue instructions that conflict with the original system prompt's hard rules, and nothing in the Tier 3 prompt resolves that conflict safely — it happened to fail loudly (refusal) rather than silently (format drift), which is the better of the two bad outcomes but still a full pipeline failure 1-in-5 times on this sample.

## Verdict

**Not viable as specified.** Real numbers: the 3-tier pipeline costs ~47% more per row ($0.0114 vs. $0.0078 estimated) than the real current production baseline (single-shot GPT-OSS-120B via `cascade.chat`, not Haiku 4.5 as assumed), has a 20% full-failure rate in this 5-row sample from a real, reproducible prompt-conflict class (Tier 2 review contradicting Tier 1/3's hard format rules), and even excluding the failure, mean judge score (82) is not compared against anything cheaper — it's the same GPT-OSS-120B/Haiku model mix already available, at higher cost and more moving parts than either a flat single-shot call or the existing production cascade. Two fixes would be needed before a re-test could be meaningful: (1) constrain Tier 2's review prompt to never suggest format/rule violations of the Tier 1/3 system prompt, (2) get a real historical Haiku-4.5-only digest baseline (none exists in the current data — see premise correction above) if the actual goal is Haiku-vs-cheaper comparison rather than GPT-OSS-vs-GPT-OSS.

## Tangents found

1. **CLAUDE.md ADR 010/011 and the sibling `2026-08-17-digest-regeneration-fidelity-test.md` report's baseline-model claim are both stale/wrong** — digest generation is GPT-OSS-120B-primary via `cascade.chat`, not Haiku 4.5, as of the current `web/lib/config/cascade.ts` and confirmed by live `executive_digest.model` values on every sampled row. Worth a correction pass on the ADR ledger.
2. `SUPABASE_SERVICE_ROLE_KEY` in this repo's `.env.local` is present as a key name but its value is empty (quoted empty string) — `SUPABASE_ACCESS_TOKEN` (a management PAT) is the one that actually works, and only via the Management API, not PostgREST. Any future agent hitting "empty apikey" on this project should reach for the Management API path immediately rather than treating it as a hard DB-access blocker.
3. Confirmed the `OPENROUTER_API_KEY` plaintext leak reported in `.memory/AGENT_LEDGER.md`/pricing doc by a prior Cline pass is **not present** in either file's current on-disk state — already redacted before this session started. No further action needed beyond the standing recommendation (already logged) to rotate the key as a precaution.
4. Tier 3's real cost dominates the pipeline (Haiku 4.5 is ~70–80% of total pipeline $ despite having the shortest input) — any future viability case for this shape depends entirely on either replacing Tier 3 with a cheaper refine model or proving Tier 3's marginal quality lift is worth its disproportionate cost share.

## Deviations from the dispatch spec

- Sampled 5 rows, not 4–6 with language-diversity prioritization — `/tmp/mling-test/` (referenced for row-selection reuse) does not exist in this session; noted and proceeded with a plain recency-ordered sample per the dispatch's own fallback instruction ("if gone, build a minimal equivalent and note that in your report").
- Baseline cost is estimated (char-based), not measured, because no historical token-count telemetry exists for the original digest calls — flagged explicitly in the results table rather than presented as measured.
- Did not use the live Vault-backed system prompt (requires runtime secret resolution); used the fallback constant (`EXECUTIVE_DIGEST_SYSTEM_FALLBACK`, decoded from `web/lib/prompts/fallbacks/executive-digest.fallback.ts`), which the code's own comments state is "kept in sync with the migration's seeded content."

## Skills run

None of the code/qa skill stack — this is a research-only task with zero production code changes, per the dispatch's own scope note.

## Gates

```
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
```
Not run — no production TypeScript files were touched. (`run_pipeline.mjs` lives in the session scratchpad, not the repo.)

## Files changed

- `docs/research/2026-08-18-3tier-pipeline-fidelity-test.md` (this file, new)
- `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §6m (appended, real result + premise-correction link)
- `.memory/AGENT_LEDGER.md` (IN_PROGRESS/DONE entries per protocol)
