-- Backfill the video-metadata columns from validation_report.metadata.
-- Until the SupabaseAnalysisAdapter fix in this PR, only the metadata blob was
-- written, so channel_id / published_at / thumbnail_url were null on every row
-- (and channel_title on rows created by the first-call path).
-- Only rows with a null channel_id (and a channelId in the blob) are touched; within
-- those rows a non-empty channel_title and non-null published_at/thumbnail_url are
-- kept (an empty channel_title is replaced from the metadata).
-- published_at is set only from a parseable date; pg_input_is_valid is checked
-- in SET (not WHERE) because it returns NULL for a NULL input, which in WHERE
-- would skip the whole row, and a bad cast would roll back the entire update.
update public.analyses set
  channel_title = coalesce(nullif(channel_title, ''), validation_report->'metadata'->>'channelTitle', channel_title),
  channel_id    = validation_report->'metadata'->>'channelId',
  published_at  = coalesce(
    published_at,
    case when pg_input_is_valid(validation_report->'metadata'->>'publishedAt', 'timestamptz')
         then (validation_report->'metadata'->>'publishedAt')::timestamptz end),
  thumbnail_url = coalesce(thumbnail_url, 'https://i.ytimg.com/vi/' || video_id || '/hqdefault.jpg')
where channel_id is null
  and validation_report->'metadata'->>'channelId' is not null;
