-- ADR 028: Temporal SQLGraph & SimHash Anchor Mesh

CREATE TABLE analysis_simhash_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    analysis_id UUID REFERENCES analyses(id) ON DELETE CASCADE,
    window_start INTEGER NOT NULL,
    window_end INTEGER NOT NULL,
    simhash_64 BIGINT NOT NULL,
    salient_claim TEXT,
    verbatim_anchor TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT analysis_simhash_anchors_analysis_id_window_start_key UNIQUE (analysis_id, window_start)
);

CREATE INDEX idx_analysis_simhash_anchors_analysis_id_window_start 
ON analysis_simhash_anchors (analysis_id, window_start);

CREATE OR REPLACE FUNCTION get_temporal_subgraph(p_analysis_id UUID)
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
SET search_path = public
AS $$
BEGIN
    -- Enforce ownership mapping
    IF NOT EXISTS (
        SELECT 1 FROM analyses a 
        WHERE a.id = p_analysis_id 
          AND (a.user_id = auth.uid() OR auth.uid() IS NULL) -- Allow service role or owner
    ) THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

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
    SELECT DISTINCT ON (anchor_id) * FROM subgraph
    ORDER BY anchor_id, depth ASC
    LIMIT 24; -- ROE bound <=24 nodes
END;
$$;

REVOKE ALL ON FUNCTION get_temporal_subgraph(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_temporal_subgraph(UUID) TO authenticated, service_role;
