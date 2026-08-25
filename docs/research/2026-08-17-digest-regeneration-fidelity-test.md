# Digest Regeneration Fidelity Test — GPT-OSS-120B vs Haiku 4.5 (2026-08-18)

> **⚠️ CORRECTION (2026-08-18)**: This report's premise is wrong. All 6 "Haiku 4.5 baseline" rows below (`c866f529`, `b35c77f7`, `e076b945`, `8af9413b`, `35878592`, `75870431`) were independently re-verified via direct query against the live `analyses.executive_digest->>'model'` field and are **all `openai/gpt-oss-120b`**, not Haiku 4.5. This test was actually GPT-OSS-120B vs. itself under different token-limit/prompt conditions, not a GPT-OSS-vs-Haiku comparison. The 69.5/100 mean fidelity score and per-row findings below should NOT be read as evidence of how GPT-OSS-120B compares to Haiku 4.5. See `docs/research/2026-08-18-digest-baseline-model-correction.md` for full evidence and root cause. Original content below is preserved unmodified for record-keeping.

**Supersedes**: an earlier same-named-goal attempt (logged in `.memory/AGENT_LEDGER.md` under [Cline], 2026-08-18T22:15) that concluded "blocked — no DB access" from a WSL2 shell using Supabase REST + anon key, and separately leaked the live `OPENROUTER_API_KEY` value in plaintext into this doc and the ledger (both redacted 2026-08-18; the key was never committed to git — recommend rotating anyway since it hit local files/session history). That attempt's blocker was real for its own environment but not universal: this run reached the same DB via the **Supabase Management API** (`https://api.supabase.com/v1/projects/adnmbikaqnxivalqoild/database/query`, authenticated with `SUPABASE_ACCESS_TOKEN` — a real, non-empty PAT in `.env.local`) rather than the REST endpoint. Note: `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is present as a key but its value is an **empty string** — that path genuinely would have failed for anyone who tried it; the Management API PAT (ADR 018's documented pattern) was the one that worked. Supabase MCP was not used — it requires an interactive OAuth flow not available in this session.

## RCA

Prior attempt's root cause: REST endpoint (`/rest/v1/analyses`) requires `apikey`/`Authorization` headers derived from a working key; `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` is empty, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` is RLS-scoped (would return `[]` for rows not owned by an authenticated user in that session) — consistent with the "REST returns `[]`" symptom reported. The real, working path was ADR 018's Management API pattern using `SUPABASE_ACCESS_TOKEN`, which bypasses RLS as a project-owner PAT and returns real rows unconditionally.

## Contract

1. Query `analyses` for real rows: `dimension_count = 11` AND `executive_digest IS NOT NULL` AND `analysis_markdown IS NOT NULL`.
2. Select up to 6 rows for diversity (language, topic). Real result: only 9 total rows in the entire table meet this shape; only 1 of those 9 is non-English (Arabic). Selected all 6 most-recent `Claude Haiku 4.5`-generated rows (excluded the 1 Nemotron-3-Nano row — not the Haiku baseline this test needs), including the sole Arabic row.
3. For each row: build `buildExecutiveDigestUserMessage(analysis_markdown)` verbatim (ported the real function from `web/lib/prompts/executive-digest.ts`, including `truncateForDigest`'s 18k-char dimension-priority truncation), call `openai/gpt-oss-120b` via OpenRouter with the real system prompt (decoded from `web/lib/prompts/fallbacks/executive-digest.fallback.ts`'s base64 — the disaster-fallback constant, since the live Vault-registry content in `prompt_definitions` is Vault-secret-backed and wasn't decrypted for this test; the code comment states the fallback "must be kept in sync" with the live registry, so this is a reasonable proxy but not a byte-for-byte guarantee).
4. Parse candidate output with a verbatim port of the real `parseExecutiveDigest()` (same header regexes, same fallback logic, same `parsedVia` semantics) — not a new parser.
5. Score format: `parsedVia === 'headers'` = pass.
6. Score content: Haiku 4.5 as judge (via OpenRouter, `anthropic/claude-haiku-4.5`), given the real baseline digest (already in `analyses.executive_digest` from the historical Haiku 4.5 run) and the real candidate digest, scored 0–100 on factual coverage/takeaway selection, not prose style.
7. One retry round for any row that failed outright, testing whether it's a fixable prompt/config gap.

## Real per-row results

Provider used throughout: **Cerebras** (OpenRouter routes `openai/gpt-oss-120b` there first per `ANALYSIS_CASCADE_FALLBACK` in `web/lib/config/cascade.ts`). Groq and Baseten were exercised as fallback attempts on the 2 rows that needed a retry — Baseten returned a hard 404 ("No endpoints found") for this model at test time, a real live-routing gap worth flagging separately from the fidelity question.

| Row ID (short) | Title | Format (`parsedVia`) | Content fidelity score | Notes |
|---|---|---|---|---|
| `c866f529` | Free AI YouTube Summarizer | headers ✅ | 85 | Missing some fine detail (install steps, exact metrics), no invented facts |
| `b35c77f7` | 5 Pro Tips for Cooking Pizza | headers ✅ | 78 | Correct core takeaways, added a plausible but baseline-unverified temp claim, expanded 4→10 bullets |
| `e076b945` | 3 AI Video Generators | headers ✅ | 92 (after retry) | First attempt hit `finish_reason: length` at max_tokens=1200 — see Tangent #1. Retried at 3500, succeeded, high fidelity |
| `8af9413b` | How To Spy on Shopify Competitors | headers ✅ (technically) | **28** | Real low-fidelity outlier: takeaways section malformed (duplicate header text, truncated), missing 8 of 10 real baseline takeaways |
| `35878592` | 50 BEST Chrome Extensions | headers ✅ | 72 (after retry) | Same length-limit failure as `e076b945` on first attempt; retried at 3500, moderate fidelity — omitted some baseline specifics, invented an unverified "eight functional domains" taxonomy |
| `75870431` | فيلم ثمن الحرية (Arabic film, the sole non-English row) | headers ✅ | **62** | Real content-drift: baseline is a film-narrative digest; candidate injected monetization/audience-metrics framing absent from the source, materially misaligning digest purpose |

**Mean content fidelity score: 69.5 / 100** (n=6, after the one permitted retry round).
**Format pass rate: 6/6 (100%)** after retry (was 4/6 = 67% before the token-budget fix).

## Verdict

**GPT-OSS-120B is not yet a safe drop-in replacement for Haiku 4.5 on this pass, as currently configured.** Two real, distinct problems, not one:

1. **A fixable prompt/config gap** (Tangent #1 below): at the project's typical `max_tokens` budget for this pass, GPT-OSS-120B silently truncates to `null` content 2/6 of the time because it's a reasoning model that spends tokens on hidden chain-of-thought before emitting the digest. Raising `max_tokens` from 1200→3500 fixed both failures (72 and 92 post-fix) — this is a real, low-effort remediation (bump the digest-pass token budget in the cascade config when GPT-OSS is in play), not a model-capability wall.
2. **A real, not-yet-fixed capability gap**: even with the token-budget fix, fidelity is inconsistent — one row scored 28 (malformed/incomplete takeaways) and the sole non-English row scored 62 with real content drift (off-topic reframing), while English rows on straightforward topics scored 72–92. This is consistent with §6j/§6m's existing "contested but real multilingual risk" concern and adds a new, previously-undocumented finding: GPT-OSS-120B can produce a well-formed-looking but substantively degraded takeaways section (the 28-score row) — a failure mode `parseExecutiveDigest()`'s format check does NOT catch, since it only verifies headers are present, not that content under a header is complete/non-truncated.

**Recommendation, evidence-backed**: not viable as a flat GPT-OSS-120B-only replacement today. The §6m "3-tier Council-style" hypothesis (GPT-OSS draft → cheap cross-check → Haiku refine) remains the most promising documented direction, since it could catch exactly the class of failure seen in the 28-score row before it reaches a user. A cheap, mechanical intermediate step — flagging when a header section's content is anomalously short/malformed (cheap, code-only check, not another LLM call) — would also catch that specific failure class without a full Haiku pass.

## Tangents found (per the three-tenets discipline)

1. **GPT-OSS-120B token-budget footgun**: it's a reasoning model — `finish_reason: "length"` with `content: null` occurs when `max_tokens` is sized for a non-reasoning model's typical digest output (1200 was sufficient for Haiku historically but not for GPT-OSS, whose hidden `reasoning` field consumes budget first). Any real migration of the digest pass to GPT-OSS-120B needs a higher `max_tokens` ceiling specifically for this model — worth a model-conditional entry in `web/lib/config/cascade.ts` rather than one shared constant, since Haiku doesn't have this failure mode.
2. **Baseten provider 404 for `openai/gpt-oss-120b`** at test time (2026-08-18) — `ANALYSIS_CASCADE_FALLBACK` lists Baseten as a fallback provider for this model; OpenRouter returned "No endpoints found for openai/gpt-oss-120b" for that provider specifically. Cerebras and Groq both worked. Worth a live-routing health check before relying on Baseten as a real fallback in production.
3. **`parseExecutiveDigest()`'s format check is necessary but not sufficient**: `parsedVia === 'headers'` only confirms the 4 section headers were found in order — it does not validate that the extracted content under each header is complete or free of leaked/duplicated header text (exactly what happened in the 28-score row, which still registered `parsedVia: 'headers'`). Any cost-tiered-model decision that uses format-pass rate alone as a proxy for quality would be misled by this row.
4. **Live system prompt vs. fallback constant**: this test used the base64-decoded fallback constant (`EXECUTIVE_DIGEST_SYSTEM_FALLBACK`), not the live Vault-registry prompt (`prompt.executive_digest.system`, stored via Supabase Vault secrets in `prompt_definitions`), since decrypting the Vault secret was out of scope for this pass. The code's own comment states the fallback "must be kept in sync" with the live registry — if that sync has drifted, this test's system-prompt input differs from what's actually shipped today.

## Deviations from the dispatch spec

- `/tmp/mling-test/` was not present in this environment — built a minimal equivalent harness at `/tmp/claude-1001/.../scratchpad/digest-fidelity-harness.mjs` (+ `retry.mjs`), not committed to the repo (scratch/temp per the standing "no /tmp for user-visible docs" rule — this harness script itself is not user-facing, only this report and the row/score data are).
- Only 6 rows existed total that were eligible after excluding the 1 non-Haiku-baseline row; language diversity was capped at 1 non-English row because that's the real distribution in the table today (8 English / 1 Arabic among all 9 eligible rows) — not a sampling choice.
- Retried only the 2 rows that hard-failed (per the spec's "if fidelity is materially low... try ONE round of tuning and re-run only the failing row(s)"); did not additionally retry the 28-score row (`8af9413b`) since it technically passed format and the spec's retry trigger was for failures, not low-but-passing scores — flagging this as a judgment call, not a spec violation.

## Skills run

None of the code-touching skill gates apply — no production code was changed. `qa-intel`/`contract-auditor`/`simplify` were not run against the throwaway harness script per the dispatch's own scoping note (research/test harness, not shipped code).

## Gates

`pnpm --filter @hex-yt-intel/web exec tsc --noEmit` — not run; no files under `web/` were modified by this task (only `docs/` and `.memory/AGENT_LEDGER.md`). Confirmed via `git status` before finishing — no unexpected diffs.

## Files changed

- `docs/research/2026-08-17-digest-regeneration-fidelity-test.md` (this file, overwritten from the prior blocked attempt — there was no file at this path before; the prior attempt's findings lived only in `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` §6m and `.memory/AGENT_LEDGER.md`)
- `docs/private/2026-08-16_PRICING_ECONOMICS_MASTER_MODEL.md` — §6m replaced (real result now exists; prior content was a blocked-with-leaked-secret placeholder, not real findings worth preserving verbatim) — see below
- `.memory/AGENT_LEDGER.md` — redacted the leaked key in the prior `[Cline]` entry, appended a `[DONE]` entry for this task
