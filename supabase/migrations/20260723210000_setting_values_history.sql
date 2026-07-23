-- Wave S: setting_values change history.
--
-- Motivation: setting_definitions (default) + setting_values (current) together
-- give "what is it now / what should it default to", but nothing captures "what
-- was it before, and when did it change" -- needed to explain a live incident
-- ("why did kg.node.weight change three days ago") without grepping deploy logs.
-- This adds ONE lean append-only table, one row per actual change, populated by
-- a trigger so every write path (present or future) is covered automatically --
-- no adapter/route has to remember to log history manually.

-- ============================================================================
-- 1. setting_values_history: one row per change
-- ============================================================================
create table if not exists public.setting_values_history (
  id           uuid primary key default gen_random_uuid(),
  setting_key  text not null references public.setting_definitions(key) on delete cascade,
  scope_type   text not null check (scope_type in ('system', 'admin', 'user')),
  scope_id     uuid,
  old_value    jsonb,          -- null on the INSERT-as-first-value case (no prior value existed)
  new_value    jsonb not null,
  changed_at   timestamptz not null default now(),
  changed_by   uuid references auth.users(id)
);

comment on table public.setting_values_history is
  'Append-only change log for public.setting_values, one row per actual value change (populated by trigger, never written to directly). Deliberately lean: no full audit-log columns (IP, user agent, request id) -- just old/new value + when/who, matching Wave S scope. Distinct from setting_definitions.default_value (factory default, unchanging) and setting_values.value (current live value) -- this table is the delta stream between them over time.';

create index if not exists idx_setting_values_history_key_scope
  on public.setting_values_history(setting_key, scope_type, scope_id, changed_at desc);

-- ============================================================================
-- 2. Trigger: log AFTER UPDATE, and AFTER INSERT for the very first value
-- ============================================================================
-- Design decisions, documented here because they're easy to get wrong:
--
-- (a) AFTER INSERT is included, with old_value = null. Reasoning: a setting_values
--     row for a given (key, scope_type, scope_id) is created exactly once and
--     then updated thereafter (see the unique constraint in the D1 migration) --
--     so the INSERT *is* the first change away from "no override, falls back to
--     setting_definitions.default_value". Recording it with old_value=null lets
--     a consumer walk the full history including "when was this setting first
--     overridden at all", not just changes after that point. The alternative
--     (skip INSERT, only log UPDATE) would silently lose that first data point.
--
-- (b) No-op updates (new value identical to old) do NOT create a history row.
--     Reasoning: this table exists to answer "what changed and when", not "every
--     write attempt" -- a write path that re-saves an unchanged value (e.g. a form
--     re-submit with no edits) is not a change and would otherwise pollute the
--     history with rows that convey zero information. jsonb equality via `is
--     distinct from` handles this correctly, including null-safety.
--
-- (c) DELETE is not handled by a history row. Reasoning: deleting a setting_values
--     row means "revert to definition default", not an update to a new value --
--     there's no new_value to record (this column is NOT NULL by design, since
--     every history row must represent a real value that was live). If a future
--     need arises to track deletions/reverts, that's a distinct event shape (no
--     new_value) and would warrant a nullable new_value column or a separate
--     table, not forcing it into this one. Out of scope for Wave S: nothing in
--     the codebase deletes setting_values rows today.
--
-- (d) changed_by is copied from NEW.updated_by (the actor column setting_values
--     already carries) rather than auth.uid(), because writes happen through the
--     service-role client (see setting_values RLS policy: system/admin-scope
--     rows are service_role only), where auth.uid() is null. The caller is
--     expected to set updated_by explicitly on write, same as it does today.
create or replace function public.log_setting_value_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.setting_values_history
      (setting_key, scope_type, scope_id, old_value, new_value, changed_by)
    values
      (NEW.setting_key, NEW.scope_type, NEW.scope_id, null, NEW.value, NEW.updated_by);
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if NEW.value is distinct from OLD.value then
      insert into public.setting_values_history
        (setting_key, scope_type, scope_id, old_value, new_value, changed_by)
      values
        (NEW.setting_key, NEW.scope_type, NEW.scope_id, OLD.value, NEW.value, NEW.updated_by);
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_log_setting_value_change on public.setting_values;
create trigger trg_log_setting_value_change
  after insert or update on public.setting_values
  for each row
  execute function public.log_setting_value_change();

-- ============================================================================
-- 3. RLS -- service-role-only, matching setting_values' own system/admin policy
--    (see "Service role can manage all setting values" in the D1 migration).
--    History rows are never written to directly (only via the trigger, which
--    runs as the table owner regardless of RLS), and reads go through the
--    settings API/adapter layer using the service client -- no client-side
--    Supabase call should ever hit this table, same reasoning as
--    settings_access_matrix.
-- ============================================================================
alter table public.setting_values_history enable row level security;

do $$
begin
  create policy "Service role can manage setting value history"
    on public.setting_values_history
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;
