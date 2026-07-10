-- ADR 006: Add transcript_hash column for cache key consistency
-- Cache keys must be based on INPUT (transcript) hash, not output (markdown) hash
-- to detect identical analyses despite markdown formatting changes

ALTER TABLE public.analyses
ADD COLUMN IF NOT EXISTS transcript_hash TEXT;

-- Create index for cache key lookups: ci:{model}:{transcriptHash}:{version}
CREATE INDEX IF NOT EXISTS idx_analyses_transcript_hash
ON public.analyses(transcript_hash);
