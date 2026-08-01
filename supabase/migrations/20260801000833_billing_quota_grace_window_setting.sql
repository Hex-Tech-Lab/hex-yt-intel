-- ADR 020 Phase 2: the 15-minute "still-processing counts against quota"
-- grace window was hardcoded in PostgresBillingAdapter.checkGate. Per
-- explicit user decision (2026-08-01): move to the registry alongside the
-- other billing/quota tunables now being centralized, rather than leaving
-- it as the one remaining magic number in this function.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'billing.quota.processingGraceWindowMs',
  'system',
  'number',
  '{"min": 0}'::jsonb,
  '900000'::jsonb,
  'How long (ms) a still-processing analysis continues counting against the monthly quota before being treated as no-longer-blocking (900000 = 15 min, the pre-existing hardcoded value). Distinct from analysis-reaper.ts''s own settle-to-terminal-status window -- this only affects live quota counting, not the row''s actual billing_status.',
  'admin'
);
