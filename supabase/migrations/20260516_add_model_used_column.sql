-- Add model_used column to analyses table to track which Claude model generated each analysis
ALTER TABLE public.analyses
ADD COLUMN IF NOT EXISTS model_used VARCHAR(255) DEFAULT 'anthropic/claude-haiku-4.5';

-- Add comment for documentation
COMMENT ON COLUMN public.analyses.model_used IS 'The OpenRouter model identifier used to generate this analysis (e.g., anthropic/claude-haiku-4.5, anthropic/claude-haiku-4.5)';
