drop trigger if exists trg_retention_policies_updated_at on public.retention_policies;
create trigger trg_retention_policies_updated_at
  before update on public.retention_policies
  for each row execute function public.update_updated_at_column();

drop index if exists public.idx_retention_policies_tier;
