-- Migration: Create 'analyses' Supabase Storage bucket & RLS policies
-- Purpose: Support question capture (/api/chat/capture-question) and monthly wiki builder (/lib/skills/wiki-builder).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'analyses',
  'analyses',
  false,
  10485760, -- 10MB limit
  ARRAY['text/markdown', 'text/markdown; charset=utf-8', 'application/json', 'text/plain']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policy: Authenticated users can insert/upload objects under raw/{user_id}/...
CREATE POLICY "Users can upload their own raw question markdowns"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'analyses' AND
  (storage.foldername(name))[1] = 'raw' AND
  (storage.foldername(name))[2] = (select auth.uid()::text)
);

-- RLS Policy: Authenticated users can select/read their own raw question markdowns
CREATE POLICY "Users can read their own raw question markdowns"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'analyses' AND
  (storage.foldername(name))[1] = 'raw' AND
  (storage.foldername(name))[2] = (select auth.uid()::text)
);

-- RLS Policy: Service role has full access
CREATE POLICY "Service role full access on analyses bucket"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'analyses')
WITH CHECK (bucket_id = 'analyses');
