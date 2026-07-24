-- Comments multi-stage sampling engine -- Phase 1 (schema).
-- Design ref: docs/specs/COMMENTS_SAMPLING_ENGINE_PLAN_2026-07-24.md.
--
-- Registers every tunable in the Settings Registry (Wave D1) per this
-- project's no-hardcoded-magic-numbers convention, and adds the tables
-- needed for Tiers 0-3: sample-run auditability, batched classification
-- results, a prepaid credit wallet/ledger for Tier 3 (uncapped, metered --
-- explicitly NOT capped per product decision), and a reconciliation log so
-- the estimate formula's parameters can be tuned from observed drift over
-- time (surfaced for human approval, not auto-mutated).

-- ============================================================================
-- 1. Settings Registry keys
-- ============================================================================
insert into public.setting_definitions (key, tier, data_type, validation, default_value, description, owner_role)
values
  (
    'comments.sampling.tier0Percent',
    'system', 'number', '{"min": 1, "max": 100}'::jsonb, '10'::jsonb,
    'Tier 0 (free) stratified sample size, as a percent of the video''s total comment count.',
    'admin'
  ),
  (
    'comments.sampling.tier1Percent',
    'system', 'number', '{"min": 1, "max": 100}'::jsonb, '20'::jsonb,
    'Tier 1 (free, auto-expand target) stratified sample size, as a percent of the video''s total comment count.',
    'admin'
  ),
  (
    'comments.sampling.minSignalCount',
    'system', 'number', '{"min": 1, "max": 10000}'::jsonb, '50'::jsonb,
    'Minimum absolute sampled-comment count. Below this, Tier 0 auto-expands to Tier 1 (see needsAutoExpand in web/lib/services/comment-sampling.ts). Chosen over a standard-error/entropy trigger to avoid depending on the batched classifier just to decide whether to expand.',
    'admin'
  ),
  (
    'comments.sampling.likeBucketCount',
    'system', 'number', '{"min": 1, "max": 20}'::jsonb, '3'::jsonb,
    'Number of like-count strata for the two-dimensional stratified sampler (like-count x recency).',
    'admin'
  ),
  (
    'comments.sampling.recencyBucketCount',
    'system', 'number', '{"min": 1, "max": 20}'::jsonb, '3'::jsonb,
    'Number of recency strata for the two-dimensional stratified sampler (like-count x recency).',
    'admin'
  ),
  (
    'comments.cochran.zScore',
    'system', 'number', '{"min": 1, "max": 4}'::jsonb, '1.96'::jsonb,
    'Z-score for Tier 2''s Cochran sample-size formula (1.96 = 95% confidence interval).',
    'admin'
  ),
  (
    'comments.cochran.marginOfError',
    'system', 'number', '{"min": 0.01, "max": 0.5}'::jsonb, '0.05'::jsonb,
    'Acceptable margin of error (as a fraction) for Tier 2''s Cochran sample-size formula. Pinned at 0.05 (±5%) -- this is what produced the confirmed ~30% figure for the SOTU-video case.',
    'admin'
  ),
  (
    'comments.cochran.pEstimate',
    'system', 'number', '{"min": 0.01, "max": 0.99}'::jsonb, '0.5'::jsonb,
    'Estimated population proportion (as a fraction) for Tier 2''s Cochran sample-size formula. 0.5 maximizes the required sample size -- the conservative default when the true proportion is unknown, which is always true here.',
    'admin'
  ),
  (
    'comments.batch.classificationBatchSize',
    'system', 'number', '{"min": 1, "max": 200}'::jsonb, '25'::jsonb,
    'Number of sampled comments per batched cheap-tier LLM classification call (rides CHAT_CASCADE, Groq GPT-OSS-120b first -- see worker/src/services/CommentClassifier.ts, Phase 5).',
    'admin'
  ),
  (
    'comments.credit.costPerCommentUsd',
    'system', 'number', '{"min": 0.00001, "max": 1}'::jsonb, '0.0005'::jsonb,
    'Estimated USD cost per comment for Tier 3 pre-commit credit estimates (fetch + batched classification). Versioned basis for /api/comments/estimate -- see comments.credit.estimateParamsVersion.',
    'admin'
  ),
  (
    'comments.credit.estimateParamsVersion',
    'system', 'number', '{"min": 1, "max": 1000}'::jsonb, '1'::jsonb,
    'Version marker for the Tier 3 estimate-formula parameters (costPerCommentUsd and any future terms). Bumped only after a human reviews systematic drift surfaced by estimate_reconciliation_log -- never auto-incremented. Every bump is itself an audited setting_values_history row.',
    'admin'
  )
on conflict (key) do nothing;

insert into public.setting_values (setting_key, scope_type, scope_id, value)
select key, 'system', null, default_value
from public.setting_definitions
where key like 'comments.%'
on conflict (setting_key, scope_type, scope_id) do nothing;

-- ============================================================================
-- 2. comment_sample_runs -- auditability ("why did I get N comments")
-- ============================================================================
create table if not exists public.comment_sample_runs (
  id                  uuid primary key default gen_random_uuid(),
  analysis_id         uuid not null references public.analyses(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  tier                smallint not null check (tier in (0, 1, 2, 3)),
  total_comment_count integer not null check (total_comment_count >= 0),
  requested_percent   numeric,
  cochran_n           integer,
  sampled_count       integer not null default 0 check (sampled_count >= 0),
  auto_expanded       boolean not null default false,
  status              text not null default 'pending' check (status in ('pending', 'sampling', 'completed', 'failed')),
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists idx_comment_sample_runs_analysis on public.comment_sample_runs(analysis_id);
create index if not exists idx_comment_sample_runs_user on public.comment_sample_runs(user_id, created_at desc);

alter table public.comment_sample_runs enable row level security;

drop policy if exists "users can read own sample runs" on public.comment_sample_runs;
create policy "users can read own sample runs" on public.comment_sample_runs
  for select using (auth.uid() = user_id);

grant select on public.comment_sample_runs to authenticated;
grant all on public.comment_sample_runs to service_role;

-- ============================================================================
-- 3. comment_classifications -- batched cheap-tier LLM classification results
-- ============================================================================
create table if not exists public.comment_classifications (
  id                     uuid primary key default gen_random_uuid(),
  comment_sample_run_id  uuid not null references public.comment_sample_runs(id) on delete cascade,
  batch_id               text not null,
  comment_external_id    text not null,
  label                  text,
  model_used             text,
  cost_usd               numeric default 0,
  created_at             timestamptz not null default now()
);

create index if not exists idx_comment_classifications_run on public.comment_classifications(comment_sample_run_id);

alter table public.comment_classifications enable row level security;

drop policy if exists "users can read own classifications" on public.comment_classifications;
create policy "users can read own classifications" on public.comment_classifications
  for select using (
    exists (
      select 1 from public.comment_sample_runs r
      where r.id = comment_classifications.comment_sample_run_id
        and r.user_id = auth.uid()
    )
  );

grant select on public.comment_classifications to authenticated;
grant all on public.comment_classifications to service_role;

-- ============================================================================
-- 4. Tier 3 credit wallet/ledger (prepaid, user-confirmed 2026-07-24 --
--    real balance the user tops up, not a per-analysis charge with no
--    persistent state)
-- ============================================================================
create table if not exists public.credit_wallets (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  balance_credits numeric not null default 0 check (balance_credits >= 0),
  updated_at      timestamptz not null default now()
);

alter table public.credit_wallets enable row level security;

drop policy if exists "users can read own wallet" on public.credit_wallets;
create policy "users can read own wallet" on public.credit_wallets
  for select using (auth.uid() = user_id);

grant select on public.credit_wallets to authenticated;
grant all on public.credit_wallets to service_role;

-- Mutations (top-up, draw-down) are service-role only -- no client-side insert/update policy.
create table if not exists public.credit_ledger (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Positive = top-up, negative = draw-down (Tier 3 charge).
  delta_credits numeric not null,
  reason        text not null check (reason in ('topup', 'tier3_charge', 'tier3_refund', 'adjustment')),
  analysis_id   uuid references public.analyses(id) on delete set null,
  comment_sample_run_id uuid references public.comment_sample_runs(id) on delete set null,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user on public.credit_ledger(user_id, created_at desc);

alter table public.credit_ledger enable row level security;

drop policy if exists "users can read own ledger" on public.credit_ledger;
create policy "users can read own ledger" on public.credit_ledger
  for select using (auth.uid() = user_id);

grant select on public.credit_ledger to authenticated;
grant all on public.credit_ledger to service_role;

-- ============================================================================
-- 5. estimate_reconciliation_log -- Tier 3 estimate-vs-actual drift tracking
--    (charge actual capped at estimate; every reconciliation event logged so
--    systematic drift can be surfaced to a human for a versioned parameter
--    bump -- see comments.credit.estimateParamsVersion above)
-- ============================================================================
create table if not exists public.estimate_reconciliation_log (
  id                     uuid primary key default gen_random_uuid(),
  comment_sample_run_id  uuid not null references public.comment_sample_runs(id) on delete cascade,
  user_id                uuid not null references auth.users(id) on delete cascade,
  estimated_comment_count integer not null,
  actual_comment_count    integer not null,
  estimated_credits       numeric not null,
  actual_credits_charged  numeric not null,
  estimate_params_version integer not null,
  created_at              timestamptz not null default now()
);

create index if not exists idx_estimate_reconciliation_run on public.estimate_reconciliation_log(comment_sample_run_id);

alter table public.estimate_reconciliation_log enable row level security;

-- Service-role only -- this is an internal drift-tracking log, not user-facing data.
grant all on public.estimate_reconciliation_log to service_role;
