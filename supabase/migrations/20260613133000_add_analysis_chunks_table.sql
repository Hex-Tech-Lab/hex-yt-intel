-- Create analysis chunks table for partial stream persistence
CREATE TABLE IF NOT EXISTS public.analysis_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES public.analyses(id) ON DELETE CASCADE,
  chunk_index int NOT NULL,
  dimensions_covered int[] NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  status varchar(50) NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT unique_analysis_chunk UNIQUE (analysis_id, chunk_index)
);

-- Index for chunk lookups by analysis_id
CREATE INDEX IF NOT EXISTS idx_analysis_chunks_analysis_id ON public.analysis_chunks(analysis_id);

-- Enable RLS
ALTER TABLE public.analysis_chunks ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view and manage their own analysis chunks
CREATE POLICY "Users can manage their own analysis chunks" ON public.analysis_chunks
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE public.analyses.id = public.analysis_chunks.analysis_id
      AND public.analyses.user_id = auth.uid()
    )
  );
