-- Replace the 2026-08-18 padded-guess digest.maxOutputTokens default (6000, set
-- from n=4 CENSORED samples that hit finish_reason=length at the then-current
-- 2000-token cap -- see 20260818000000_digest_max_output_tokens.sql) with a
-- real empirically-derived value.
--
-- Method (full report: docs/research/2026-08-18-digest-token-cap-empirical-study.md):
-- Pulled all 88 real historical `analyses` rows with a non-null executive_digest
-- and non-empty analysis_markdown (all genuinely GPT-OSS-120B, the production
-- digest model -- confirmed via executive_digest->>'model'). Stratified-sampled
-- 24 of them evenly across the FULL real input-size range (analysis_markdown
-- 3,932-62,044 chars) and regenerated each digest fresh against the LIVE
-- production system prompt (Vault-backed prompt.executive_digest.system) and
-- the real buildExecutiveDigestUserMessage()/truncateForDigest() input
-- construction, this time at an UNCAPPED max_tokens=8000 so the real
-- completion_tokens could be observed with zero truncation censoring (the
-- prior 6000 estimate was built from truncated/censored data, not real
-- maxima).
--
-- Result (n=24, 2026-08-18): completion_tokens observed range 861-2471
-- (mean 1563.5, median 1517.5); ALL 24 finished with finish_reason=stop (no
-- truncation at 8000). Pearson r = 0.13 between input character count and
-- output token count -- output size is effectively INDEPENDENT of input
-- size (the digest is always ~4 fixed sections regardless of source-material
-- length), so no per-input scaling formula is justified here, only a flat
-- cap. Empirical max = 2471 tokens, observed on the single largest-input row
-- (62,044 chars) in the sample.
--
-- Cap = empirical max * 1.18 margin (18%, per project no-hardcoded-magic-
-- numbers rule: check -> count -> estimate) = 2471 * 1.18 = 2916.28,
-- rounded to 3000.
--
-- n=24 clears a reasonable confidence threshold for a flat cap (not a
-- per-input formula, since none is supported), but is not exhaustive of all
-- 88 available rows -- flagged honestly, not asserted as a full-population
-- guarantee.

update public.setting_definitions
set default_value = '3000'::jsonb,
    description = 'max_tokens for the Dimension-0 executive digest completion (OpenRouterCompletionAdapter.complete, digest.maxOutputTokens). Empirically derived 2026-08-18 (docs/research/2026-08-18-digest-token-cap-empirical-study.md): n=24 real historical rows (GPT-OSS-120B, production model), stratified evenly across the full real input-size range (analysis_markdown 3,932-62,044 chars), regenerated fresh at an uncapped max_tokens=8000 to observe true completion_tokens with zero truncation censoring. Observed completion_tokens range 861-2471 (mean 1563.5, median 1517.5), Pearson r=0.13 between input chars and output tokens -- output size is effectively input-independent (digest is always ~4 fixed sections regardless of source length), so no per-input scaling formula is justified, only a flat cap. Empirical max = 2471 (largest-input row, 62,044 chars). Cap = 2471 * 1.18 (18% margin per project no-hardcoded-magic-numbers rule) = 2916, rounded to 3000. Replaces the prior 6000 default, which was a padded guess set from n=4 censored/truncated samples (finish_reason=length hit at the old 2000 cap) rather than real uncensored output-token data.'
where key = 'digest.maxOutputTokens';

update public.setting_values
set value = '3000'::jsonb
where setting_key = 'digest.maxOutputTokens' and scope_type = 'system' and scope_id is null and value = '6000'::jsonb;
