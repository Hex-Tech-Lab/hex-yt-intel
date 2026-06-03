-- ============================================================================
-- BASELINE: core tables (repair for fresh-DB / preview-branch replay)
-- ============================================================================
-- The core tables (users, analyses, usage_logs, stripe_events) were originally
-- bootstrapped OUT OF BAND on prod — no migration ever CREATEd them. As a result a
-- fresh database (every Supabase preview branch) failed replay at the first
-- `ALTER TABLE public.analyses ...` (20260516), because the table did not exist.
--
-- This baseline recreates them idempotently (`create table if not exists`) ordered
-- BEFORE all other migrations, mirroring the CURRENT prod schema (derived via DDL
-- introspection). On prod every statement is a no-op (objects already exist); on a
-- fresh branch it provides the tables so the full history replays cleanly.
--
-- Faithful to prod: id PK only (prod has no FKs / UNIQUE / extra constraints on these
-- — the later `ADD COLUMN ... UNIQUE` statements were no-ops against bootstrap cols).
-- All columns are included so later `ADD COLUMN IF NOT EXISTS` migrations become
-- no-ops AND out-of-order forward references (e.g. embedding) resolve. The ONE
-- exception is users.role: it is added (non-idempotently) by 20260521203314, and
-- nothing before that references the column, so it is intentionally omitted here.
-- ============================================================================

create extension if not exists vector;

-- users (role added later by 20260521203314) -------------------------------
create table if not exists public.users (
  id                     uuid primary key default gen_random_uuid(),
  email                  text not null,
  name                   text,
  avatar_url             text,
  tier                   text default 'free',
  stripe_customer_id     text,
  stripe_subscription_id text,
  analyses_used          integer not null default 0,
  last_reset_date        timestamptz default now(),
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

-- analyses ------------------------------------------------------------------
create table if not exists public.analyses (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null,
  video_id          text not null,
  title             text,
  channel_title     text,
  channel_id        text,
  published_at      timestamp,
  duration_seconds  integer,
  view_count        bigint default 0,
  like_count        integer default 0,
  comment_count     integer default 0,
  thumbnail_url     text,
  analysis_markdown text not null,
  embedding         vector(1536),
  created_at        timestamp default current_timestamp,
  updated_at        timestamp default current_timestamp,
  shared_token      varchar,
  shared_expires_at timestamptz,
  model_attempted   text default 'anthropic/claude-haiku-4.5',
  validation_report jsonb,
  validation_passed boolean default false,
  model_used        text default 'anthropic/claude-haiku-4.5'
);

-- usage_logs ----------------------------------------------------------------
create table if not exists public.usage_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  action      text not null,
  tokens_used integer default 0,
  cost_usd    numeric default 0,
  metadata    jsonb,
  created_at  timestamptz default current_timestamp
);

-- stripe_events -------------------------------------------------------------
create table if not exists public.stripe_events (
  id           text primary key,
  user_id      uuid,
  event_type   text not null,
  amount_cents integer,
  status       text,
  payload      jsonb,
  created_at   timestamptz default current_timestamp
);

-- Match prod RLS posture (policies are added by later migrations).
alter table public.users        enable row level security;
alter table public.analyses     enable row level security;
alter table public.usage_logs   enable row level security;
alter table public.stripe_events enable row level security;
