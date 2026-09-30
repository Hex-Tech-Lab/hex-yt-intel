-- ADR 037 Addendum A6 (R3b step 2.3): per-video cost cap for the Jev
-- planning pass. Registry-driven per the standing no-hardcoded-tunables
-- directive. NOT applied by the implementing agent (ADR 018: CC applies
-- migrations). Applied on merge by CI / the Supabase integration, in its own PR before the 2.3 code.
--
-- Default derivation (2026-10-01, §5.0.1 rule 6 — empirically bounded):
-- a 48,000-char transcript (analysis.transcriptBudgetChars default) is
-- ~8,000 words ≈ 11,800 input tokens/call at the 1.35 words→tokens factor
-- plus a 1,000-token prompt prefix, +8,192 max output tokens ≈ ~20K
-- tokens/call. At the most expensive resolved cascade price (Sonnet 5,
-- $0.003/1K blended) that is ~6¢ per grounded call → K=1 plan ≈ 4×6¢ + ~3¢
-- (projective) ≈ 27¢. A 100¢ default leaves ~3.7× headroom, so K=1 is
-- never truncated at current prices — the cap only bites when Jev (K>1)
-- multiplies stream count.

insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'analysis.jev.maxCostUsdCentsPerVideo',
    'system',
    'number',
    '{"min": 1, "max": 100000}'::jsonb,
    '100'::jsonb,
    'Per-video worst-case LLM cost cap in USD cents (ADR 037 Addendum A6). PlanAnalysisUseCase merges the smallest adjacent Jev chunks until the estimate fits; if even K=1 exceeds the cap, the analysis falls back to today''s transcriptBudgetChars truncation path.',
    'admin'
  )
on conflict (key) do nothing;
