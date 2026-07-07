-- Dimension 0 — Executive Digest storage.
--
-- A single, cheap post-synthesis pass (see web/lib/prompts/executive-digest.ts)
-- turns the completed 11-dimension analysis into a three-tier digest:
-- snapshot / key takeaways / overview. It is generated lazily on first view via
-- POST /api/analyses/digest and cached here as jsonb so the "#12 call" runs at
-- most once per analysis.
--
-- Additive + nullable: pre-existing rows read as "no digest yet", and nothing
-- that keys off the 1..11 dimension range (dimension_count, completeness
-- status, the reaper) is affected — Dim-0 is uncounted, never a 12th dimension.
alter table public.analyses
  add column if not exists executive_digest jsonb;
