-- CRITICAL SECURITY FIX: users_update_own's WITH CHECK only verifies
-- auth.uid() = id -- it never restricts which columns a user can change or
-- what value `role` can take. Confirmed via direct RLS-policy read (this
-- migration's file) that any authenticated user can currently self-promote
-- via `supabase.from('users').update({role:'admin'}).eq('id', session.user.id)`
-- and it passes RLS clean. This is a live privilege-escalation hole, not
-- theoretical -- admin-gated routes (e.g. the users-activity RPC, the
-- admin analysis-export bypass added 2026-08-03) all trust `users.role`
-- as the sole authorization signal.
--
-- Fix: a BEFORE UPDATE trigger that rejects (not silently reverts -- this
-- repo's own qa-intel rules explicitly treat silent-failure/silent-revert
-- as an anti-pattern) any attempt by a non-service-role caller to change
-- their own `role` column. service_role (used by admin-only server-side
-- code paths, e.g. an eventual admin-promote endpoint) is exempt.

create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'role cannot be changed by this caller'
      using errcode = '42501'; -- insufficient_privilege
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_self_role_escalation() from public, anon, authenticated;

drop trigger if exists trg_prevent_self_role_escalation on public.users;
create trigger trg_prevent_self_role_escalation
  before update on public.users
  for each row
  execute function public.prevent_self_role_escalation();
