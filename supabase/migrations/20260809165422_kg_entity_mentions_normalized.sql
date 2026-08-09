-- ADR 026 Phase 2: normalized (3NF) persistence for grounded entity mentions.
-- Explicit user direction (2026-08-09): no JSONB blob for mentions -- a real
-- normalized table, one row per mention, FK to kg_entities. All 836 existing
-- kg_entities rows are pre-launch test data (confirmed by user, ~3 months of
-- development traffic) -- normalizing kg_entities.type to POLE+O is accepted
-- to lose the old free-form category values rather than attempt an unreliable
-- automated remap of arbitrary legacy strings to 5 fixed categories.

-- 1. Normalize kg_entities.type to POLE+O going forward.
-- One-time data transform: old free-form values (e.g. "technology", "tool")
-- have no reliable automated mapping to Person/Organization/Location/Event/
-- Object without re-running LLM classification (out of scope, test data,
-- accepted per explicit user direction) -- default them all to 'Object', the
-- correct POLE+O catch-all, rather than fabricate a false-precision mapping.
update public.kg_entities set type = 'Object' where type not in ('Person', 'Organization', 'Location', 'Event', 'Object');

alter table public.kg_entities add constraint kg_entities_type_poleo_check
  check (type in ('Person', 'Organization', 'Location', 'Event', 'Object'));

comment on column public.kg_entities.type is
  'POLE+O base entity type (ADR 026 Sec6.2), enforced going forward by kg_entities_type_poleo_check. Values before 2026-08-09 were free-form LLM-invented categories, normalized to Object in a one-time migration (test data, no reliable automated remap to POLE+O existed).';

-- 2. Normalized mentions table -- one row per real chunk-scoped grounded
-- occurrence of an entity (ADR 026 Sec4.4's 1-to-many shape). Scoped to
-- Problem A (video_timestamp) only, per ADR Sec1/Sec9 -- extending to
-- Problem C's other GroundedLocation variants (pdf_page, audio_timestamp,
-- spreadsheet_cell, text_offset) later is an additive ALTER TABLE (nullable
-- columns), not a breaking schema change, when that phase is prioritized.
create table if not exists public.kg_entity_mentions (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.kg_entities(id) on delete cascade,
  chunk_id          text not null,
  video_timestamp_seconds numeric not null check (video_timestamp_seconds >= 0),
  match_method      text not null check (match_method in ('exact', 'embedding')),
  match_confidence  numeric not null check (match_confidence >= 0 and match_confidence <= 1),
  created_at        timestamptz not null default now()
);

comment on table public.kg_entity_mentions is
  'ADR 026 Phase 2: one row per chunk-scoped grounded mention of a kg_entities row. Normalized (3NF), not a JSONB blob, per explicit user direction 2026-08-09. video_timestamp_seconds-only for now (Problem A scope); future GroundedLocation variants (pdf_page etc.) are additive columns when Problem C is prioritized, not a breaking change.';

create index if not exists idx_kg_entity_mentions_entity_id on public.kg_entity_mentions(entity_id);

alter table public.kg_entity_mentions enable row level security;

do $$
begin
  create policy "Authenticated users can read kg entity mentions"
    on public.kg_entity_mentions
    for select
    using (auth.role() = 'authenticated');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Only service role can write kg entity mentions"
    on public.kg_entity_mentions
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

revoke all on public.kg_entity_mentions from anon, authenticated, public;
grant select on public.kg_entity_mentions to authenticated;
