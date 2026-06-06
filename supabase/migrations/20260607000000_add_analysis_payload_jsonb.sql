-- Migration: add_analysis_payload_jsonb
-- Date: 2026-06-07
-- Description: Adds JSONB column for structured analysis payload (dual-write with markdown)
--              Supports ADR 006 Structured JSON Streaming - v2.0 schema

-- Add JSONB column for structured analysis payload
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS analysis_payload JSONB DEFAULT '{}'::jsonb;

-- Index for querying by schema version
CREATE INDEX IF NOT EXISTS idx_analyses_payload_schema
  ON analyses ((analysis_payload->>'schemaVersion'));

-- GIN index for full-text search within JSON payload
CREATE INDEX IF NOT EXISTS idx_analyses_payload_gin
  ON analyses USING GIN (analysis_payload);

COMMENT ON COLUMN analyses.analysis_payload IS
  'Structured JSON payload (v2.0 schema per ADR 006). Dual-write with analysis_markdown during migration. Contains dimensions[], knowledgeGraph{}, classification{}, persona{}.';