-- ADR 020 Phase 2: widen billing_status to support a real 'cancelled'
-- state, distinct from 'failed'. 'failed' means the system didn't deliver;
-- 'cancelled' means the user explicitly chose to stop what would have
-- delivered (ADR 020's gym-class decision: leaving early still counts).
-- Verified the LIVE constraint directly before this change (not the TS
-- type) per the earlier billing_status drift lesson: as of this migration
-- it was `CHECK (billing_status = ANY (ARRAY['processing','completed','failed']))`.

alter table public.analyses
  drop constraint check_billing_status;

alter table public.analyses
  add constraint check_billing_status
  check (billing_status = any (array['processing', 'completed', 'failed', 'cancelled']));

-- billing.chargeOnCancel: whether a user-cancelled analysis still counts
-- against their monthly quota (the actual "charge" -- this app is
-- quota-based, not metered $ billing). Default true per explicit user
-- decision: "if somebody leaves mid-class, they should be charged for the
-- class anyway." Enforced in PostgresBillingAdapter.checkGate, not
-- hardcoded -- the user was explicit that this must be a setting, not a
-- hardcoded true, consistent everywhere it's read.
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values (
  'billing.chargeOnCancel',
  'system',
  'boolean',
  '{}'::jsonb,
  'true'::jsonb,
  'Whether a user-initiated cancel (POST /api/analyses/[id]/cancel) still counts the analysis against the user''s monthly quota. true = leaving early still costs the seat (gym-class model). Read in PostgresBillingAdapter.checkGate.',
  'admin'
);
