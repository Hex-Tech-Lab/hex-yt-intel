-- Create admin_settings table (singleton configuration)
create table if not exists public.admin_settings (
  id text primary key default 'default',
  total_dimensions integer not null default 11,
  min_usable_dimensions integer not null default 8,
  stream_bundles jsonb not null default '[{"dimensions": [1]}, {"dimensions": [8]}, {"dimensions": [2, 4, 6]}, {"dimensions": [5, 7, 10]}, {"dimensions": [3, 9, 11]}]'::jsonb,
  dimension_configs jsonb not null,
  model_cascade text[] not null default '{"nemotron-3-nano", "claude-haiku-4-5"}',
  connection_handshake_timeout_ms integer not null default 3000,
  token_streaming_window_ms integer not null default 25000,
  max_retries integer not null default 3,
  retry_backoff_ms integer not null default 1000,
  abort_on_partial_failure boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint admin_settings_singleton check (id = 'default')
);

-- Create user_settings table (per-user preferences)
create table if not exists public.user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  preferred_model text,
  analysis_detail_level text check (analysis_detail_level in ('basic', 'standard', 'comprehensive')),
  auto_save_analyses boolean not null default true,
  notifications_enabled boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Create indexes for performance
create index if not exists idx_user_settings_user_id on public.user_settings(user_id);

-- Enable RLS (Row Level Security)
alter table public.admin_settings enable row level security;
alter table public.user_settings enable row level security;

-- RLS Policies for admin_settings (read-only for authenticated users)
create policy "Allow public read of admin settings"
  on public.admin_settings
  for select
  using (true);

create policy "Only service role can update admin settings"
  on public.admin_settings
  for update
  using (auth.role() = 'service_role');

-- RLS Policies for user_settings (users can only access their own)
create policy "Users can read their own settings"
  on public.user_settings
  for select
  using (auth.uid() = user_id);

create policy "Users can update their own settings"
  on public.user_settings
  for update
  using (auth.uid() = user_id);

create policy "Users can insert their own settings"
  on public.user_settings
  for insert
  with check (auth.uid() = user_id);
