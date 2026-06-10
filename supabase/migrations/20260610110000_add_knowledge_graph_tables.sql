-- Create KG entities table
CREATE TABLE IF NOT EXISTS kg_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analyses(id) ON DELETE CASCADE,
  label text NOT NULL,
  type text NOT NULL,
  weight int NOT NULL DEFAULT 1,
  created_at timestamp with time zone DEFAULT now()
);

-- Create KG relations table
CREATE TABLE IF NOT EXISTS kg_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid REFERENCES analyses(id) ON DELETE CASCADE,
  source_entity_id uuid REFERENCES kg_entities(id) ON DELETE CASCADE,
  target_entity_id uuid REFERENCES kg_entities(id) ON DELETE CASCADE,
  relation_label text NOT NULL,
  strength int NOT NULL DEFAULT 1,
  created_at timestamp with time zone DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_kg_entities_analysis_id ON kg_entities(analysis_id);
CREATE INDEX IF NOT EXISTS idx_kg_relations_analysis_id ON kg_relations(analysis_id);
CREATE INDEX IF NOT EXISTS idx_kg_relations_source_target ON kg_relations(source_entity_id, target_entity_id);

-- Enable RLS
ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE kg_relations ENABLE ROW LEVEL SECURITY;

-- Policy for Entities: Users can manage entities of their own analyses
CREATE POLICY "Users can manage entities of their own analyses" ON kg_entities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM analyses
      WHERE analyses.id = kg_entities.analysis_id
      AND analyses.user_id = auth.uid()
    )
  );

-- Policy for Relations: Users can manage relations of their own analyses
CREATE POLICY "Users can manage relations of their own analyses" ON kg_relations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM analyses
      WHERE analyses.id = kg_relations.analysis_id
      AND analyses.user_id = auth.uid()
    )
  );
