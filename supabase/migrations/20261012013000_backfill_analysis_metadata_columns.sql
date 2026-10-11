-- Backfill the video-metadata columns from validation_report.metadata.
-- Until the SupabaseAnalysisAdapter fix in this PR, only the metadata blob was
-- written, so channel_id / published_at / thumbnail_url were null on every row
-- (and channel_title on rows created by the first-call path).
-- Fills empty columns only and never overwrites a value already set.
update public.analyses set
  channel_title = coalesce(nullif(channel_title, ''), validation_report->'metadata'->>'channelTitle'),
  channel_id    = validation_report->'metadata'->>'channelId',
  published_at  = coalesce(published_at, (validation_report->'metadata'->>'publishedAt')::timestamptz),
  thumbnail_url = coalesce(thumbnail_url, 'https://i.ytimg.com/vi/' || video_id || '/hqdefault.jpg')
where channel_id is null
  and validation_report->'metadata'->>'channelId' is not null
  and (validation_report->'metadata'->>'publishedAt') ~ '^\d{4}-\d{2}-\d{2}';
