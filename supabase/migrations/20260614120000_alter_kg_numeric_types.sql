-- Alter kg_entities table: weight
-- Using NUMERIC(5,2) to limit precision and mitigate storage risks (bounded to 999.99).
ALTER TABLE kg_entities ALTER COLUMN weight TYPE numeric(5,2) USING weight::numeric(5,2);

-- Alter kg_relations table: strength
-- Using NUMERIC(5,2) to limit precision and mitigate storage risks (bounded to 999.99).
ALTER TABLE kg_relations ALTER COLUMN strength TYPE numeric(5,2) USING strength::numeric(5,2);
