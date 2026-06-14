-- Add raw_node column to kg_entities
ALTER TABLE kg_entities ADD COLUMN IF NOT EXISTS raw_node JSONB;

-- Add raw_edge column to kg_relations
ALTER TABLE kg_relations ADD COLUMN IF NOT EXISTS raw_edge JSONB;

-- Add comment for documentation
COMMENT ON COLUMN kg_entities.raw_node IS 'Lossless storage for original node payload from LLM';
COMMENT ON COLUMN kg_relations.raw_edge IS 'Lossless storage for original edge payload from LLM';
