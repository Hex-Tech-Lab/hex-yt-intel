-- Add video_id column to chat_conversations so video grounding survives
-- even when analysis_id is null (general chat) or the referenced analysis is deleted.
-- Previously videoId was only available via the analyses(video_id) join in the
-- SELECT query, which broke when analysis_id was null or the analysis was removed.

alter table public.chat_conversations
  add column if not exists video_id text;

comment on column public.chat_conversations.video_id is
  'Denormalized YouTube video ID for fast lookup without joining analyses.';

-- Backfill existing rows from the analysis they reference.
update public.chat_conversations c
   set video_id = a.video_id
  from public.analyses a
 where c.analysis_id = a.id
   and c.video_id is null;