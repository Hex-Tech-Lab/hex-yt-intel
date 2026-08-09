-- Cubic review round 2 on PR #230: real findings, verified against live state
-- before fixing (not trusted from the report alone).
--
-- REFUTED after live check: "type NOT NULL not enforced" -- information_schema
-- confirms kg_entities.type is already NOT NULL (was set that way originally,
-- unrelated to this migration). No fix needed, noted not silently dropped.
--
-- REAL, fixed here:
-- 1. RLS scoping bug: kg_entity_mentions got a blanket "any authenticated user
--    can read" policy, but kg_entities itself has a real tenant-scoped policy
--    ("Users can manage entities of their own analyses", scoped via
--    analyses.user_id = auth.uid()) -- confirmed live via pg_policies. The
--    mismatch meant any authenticated user could read any other user's entity
--    mentions. Fixed to match the real established pattern.
-- 2. No idempotency key: a retried/re-run extraction chunk could insert
--    duplicate mention rows for the same (entity, chunk). Added a unique
--    constraint -- one mention per entity per chunk is the correct identity
--    per ADR 026 Sec4.4 (a chunk either grounds an entity once or not at all).
-- 3. video_timestamp_seconds >= 0 does not exclude NaN/Infinity -- Postgres
--    numeric treats NaN as comparing greater than all other values, so
--    `NaN >= 0` is TRUE and passes the existing check. Added an explicit guard.
--
-- Declined (reasoning, not silently skipped):
-- - "idempotent exception-swallowing hides schema drift": matches this
--   project's own repo-wide migration convention (do $$ ... exception when
--   duplicate_object then null end $$, used in every prior RLS-policy
--   migration this session and before) -- not unique to this migration.
-- - "ON DELETE CASCADE may destroy audit evidence": mentions have no
--   independent meaning once their entity is deleted/merged -- CASCADE is the
--   correct behavior here, not a gap.
-- - chunk_id has no FK: intentional, not an oversight -- Phase 2's extraction
--   chunks (groupSegmentsIntoChunks) are computed on the fly per analysis run,
--   never persisted as their own canonical table row, so there is nothing for
--   chunk_id to reference. Documented explicitly below instead of a fake FK.

drop policy if exists "Authenticated users can read kg entity mentions" on public.kg_entity_mentions;
drop policy if exists "Only service role can write kg entity mentions" on public.kg_entity_mentions;

do $$
begin
  create policy "Users can read entity mentions of their own analyses"
    on public.kg_entity_mentions
    for select
    using (
      exists (
        select 1 from public.kg_entities
        join public.analyses on analyses.id = kg_entities.analysis_id
        where kg_entities.id = kg_entity_mentions.entity_id
          and analyses.user_id = (select auth.uid())
      )
    );
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

alter table public.kg_entity_mentions
  add constraint kg_entity_mentions_entity_chunk_unique unique (entity_id, chunk_id);

-- Postgres numeric treats NaN as equal to itself (unlike IEEE floats, by
-- design, so it can be used in ORDER BY/indexes) -- `x = x` does NOT exclude
-- it. Must compare against the literal values explicitly.
alter table public.kg_entity_mentions
  add constraint kg_entity_mentions_timestamp_finite
  check (video_timestamp_seconds != 'NaN'::numeric and video_timestamp_seconds != 'Infinity'::numeric);

comment on column public.kg_entity_mentions.chunk_id is
  'Intentionally not a foreign key -- Phase 2 extraction chunks (groupSegmentsIntoChunks) are computed on the fly per analysis run and never persisted as their own table row, so there is no canonical chunk table to reference. Scoped/unique only within one analysis run via the (entity_id, chunk_id) unique constraint.';
