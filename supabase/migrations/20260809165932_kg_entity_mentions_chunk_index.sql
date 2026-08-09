-- AGY code review on PR #230: kg_entity_mentions will be filtered/joined by
-- chunk_id during Phase 2 worker extraction (per-chunk verification/resolution
-- passes) as often as by entity_id -- add the missing index. The FOR ALL RLS
-- policy suggestion was NOT applied: service_role has rolbypassrls=true
-- (confirmed live this session, see docs/audit/DB_ARCH_10X_AUDIT_2026-08-09_VERIFIED.md),
-- so the policy is defense-in-depth documentation, not an enforcement gap --
-- FOR ALL matches this table's own sibling (retention_policies, setting_definitions),
-- splitting into per-action policies here would be inconsistent with that
-- established convention for no real behavior change.

create index if not exists idx_kg_entity_mentions_chunk_id on public.kg_entity_mentions(chunk_id);
