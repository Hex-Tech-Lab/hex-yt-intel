-- ============================================================================
-- DRAFT: Backfill Transcript Expiration Timestamps
-- ============================================================================
-- DO NOT RUN THIS AGAINST PRODUCTION WITHOUT HUMAN REVIEW
-- This is a draft proposal only, verify the first-seen-time logic against
-- actual data patterns before executing.
--
-- Background:
-- A bug in SupabaseTranscriptAdapter.upsertTranscript() was resetting both
-- created_at and expires_at on every upsert, causing the 72-hour compliance
-- retention window to restart indefinitely for actively-revisited videos.
--
-- This backfill:
-- 1. Anchors created_at to the earliest analyses.created_at for each video_id
-- 2. Recalculates expires_at as created_at + 72 hours
-- 3. Leaves untouched any transcripts with no corresponding analyses
-- ============================================================================

-- ============================================================================
-- PREVIEW: Show which rows would be corrected (safe SELECT-only query)
-- ============================================================================
-- Run this first to review impact before applying the UPDATE below.
--
SELECT
  t.video_id,
  t.created_at AS current_created_at,
  t.expires_at AS current_expires_at,
  MIN(a.created_at) AS earliest_analysis_created_at,
  (MIN(a.created_at)::timestamptz + interval '72 hours') AS recalculated_expires_at,
  CASE
    WHEN t.created_at = MIN(a.created_at) AND
         t.expires_at = (MIN(a.created_at)::timestamptz + interval '72 hours')
    THEN 'NO_CHANGE'
    ELSE 'NEEDS_UPDATE'
  END AS status
FROM transcripts t
INNER JOIN analyses a ON t.video_id = a.video_id
GROUP BY t.video_id, t.created_at, t.expires_at
HAVING t.created_at != MIN(a.created_at) OR
       t.expires_at != (MIN(a.created_at)::timestamptz + interval '72 hours')
ORDER BY MIN(a.created_at) DESC
LIMIT 1000;

-- ============================================================================
-- UPDATE: Apply the fix (COMMENTED OUT — review preview results first)
-- ============================================================================
-- Only uncomment and run after:
-- 1. Reviewing the PREVIEW results above
-- 2. Confirming that earliest_analysis_created_at is the correct anchor point
-- 3. Manual testing in a staging environment
-- 4. Backup of production database
--
-- UPDATE transcripts t
-- SET
--   created_at = earliest.earliest_analysis_created_at,
--   expires_at = (earliest.earliest_analysis_created_at::timestamptz + interval '72 hours'),
--   last_accessed_at = NOW()
-- FROM (
--   SELECT
--     video_id,
--     MIN(created_at) AS earliest_analysis_created_at
--   FROM analyses
--   GROUP BY video_id
-- ) AS earliest
-- WHERE t.video_id = earliest.video_id
-- AND (
--   t.created_at != earliest.earliest_analysis_created_at
--   OR t.expires_at != (earliest.earliest_analysis_created_at::timestamptz + interval '72 hours')
-- );
