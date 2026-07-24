-- Atomic credit-wallet debit/credit for Tier 3 comment sampling (Phase 4).
-- Mirrors the existing increment_user_quota_atomic pattern in this repo
-- (atomic UPDATE ... WHERE balance check ... RETURNING, not a select-then-
-- write in application code, which would race under concurrent Tier 3
-- starts from the same user).

create or replace function public.debit_credit_wallet(p_user_id uuid, p_amount numeric)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated boolean;
begin
  if p_amount <= 0 then
    raise exception 'debit_credit_wallet: p_amount must be positive, got %', p_amount;
  end if;

  insert into public.credit_wallets (user_id, balance_credits)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  update public.credit_wallets
  set balance_credits = balance_credits - p_amount,
      updated_at = now()
  where user_id = p_user_id
    and balance_credits >= p_amount
  returning true into v_updated;

  return coalesce(v_updated, false);
end;
$$;

create or replace function public.credit_wallet(p_user_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 then
    raise exception 'credit_wallet: p_amount must be positive, got %', p_amount;
  end if;

  insert into public.credit_wallets (user_id, balance_credits)
  values (p_user_id, p_amount)
  on conflict (user_id) do update
    set balance_credits = public.credit_wallets.balance_credits + excluded.balance_credits,
        updated_at = now();
end;
$$;

revoke execute on function public.debit_credit_wallet(uuid, numeric) from public, anon, authenticated;
revoke execute on function public.credit_wallet(uuid, numeric) from public, anon, authenticated;
grant execute on function public.debit_credit_wallet(uuid, numeric) to service_role;
grant execute on function public.credit_wallet(uuid, numeric) to service_role;
