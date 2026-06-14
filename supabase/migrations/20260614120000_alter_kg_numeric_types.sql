-- Alter kg_entities table: weight
ALTER TABLE kg_entities ALTER COLUMN weight TYPE numeric USING weight::numeric;

-- Alter kg_relations table: strength
ALTER TABLE kg_relations ALTER COLUMN strength TYPE numeric USING strength::numeric;
