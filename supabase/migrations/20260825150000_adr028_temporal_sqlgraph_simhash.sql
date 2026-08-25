-- ADR 028: Temporal SQLGraph & SimHash Anchor Mesh

CREATE TABLE analysis_simhash_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    simhash_64 BIGINT NOT NULL,
    salient_claim TEXT,
    verbatim_anchor TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_simhash_anchors_analysis_id_window_start 
ON analysis_simhash_anchors (analysis_id, window_start);

CREATE OR REPLACE FUNCTION get_temporal_subgraph(p_analysis_id UUID, p_entity_filter TEXT[])
RETURNS TABLE(
    anchor_id UUID,
    window_start INTEGER,
    window_end INTEGER,
    simhash_64 BIGINT,
    salient_claim TEXT,
    verbatim_anchor TEXT,
    depth INTEGER
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH RECURSIVE subgraph AS (
        -- Base Case: Anchor nodes for this analysis
        SELECT 
            a.id AS anchor_id, 
            a.window_start, 
            a.window_end, 
            a.simhash_64, 
            a.salient_claim, 
            a.verbatim_anchor,
            0 AS depth
        FROM analysis_simhash_anchors a
        WHERE a.analysis_id = p_analysis_id
        
        UNION ALL
        
        -- Recursive Step (Mocked temporal/entity relations bounded traversal)
        -- Since true entity tables are not fully specified, we simulate the recursion
        -- on adjacent temporal nodes.
        SELECT 
            a.id, 
            a.window_start, 
            a.window_end, 
            a.simhash_64, 
            a.salient_claim, 
            a.verbatim_anchor,
            sg.depth + 1
        FROM analysis_simhash_anchors a
        INNER JOIN subgraph sg ON a.analysis_id = p_analysis_id
                               AND (a.window_start >= sg.window_end AND a.window_start < sg.window_end + 30)
        WHERE sg.depth < 3  -- ROE bound on traversal depth
    )
    SELECT * FROM subgraph
    LIMIT 24; -- ROE bound <=24 nodes
END;
$$;
