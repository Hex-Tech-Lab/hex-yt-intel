-- Landing page waitlist capture (v-intel visual-scrubber value prop test)
create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text not null default 'landing_page',
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_signups_email_key on public.waitlist_signups (lower(email));

alter table public.waitlist_signups enable row level security;

-- Insert-only for anonymous visitors submitting the landing page form.
-- No select/update/delete grant to anon — write-only capture, read via service_role/dashboard only.
create policy "anon can insert waitlist signups"
  on public.waitlist_signups
  for insert
  to anon
  with check (true);

revoke all on public.waitlist_signups from anon, authenticated, public;
grant insert on public.waitlist_signups to anon;
