-- Fix: get_temporal_subgraph (ADR 028) had a fail-open IDOR.
-- `auth.uid() IS NULL` was used as a proxy for "service role", but EXECUTE
-- is granted to `authenticated` too. Any authenticated session where
-- auth.uid() legitimately resolves NULL (malformed JWT, anon-upgrade edge
-- case) could read another user's analysis_simhash_anchors content
-- (salient_claim / verbatim_anchor = real transcript text) cross-tenant.
-- Same failure class ADR 009 was written to prevent; this function did not
-- follow that pattern. Fix: check the JWT's actual role claim instead of
-- inferring service-role from a null uid.

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
    -- Enforce ownership mapping: owner, or a genuine service-role caller
    -- (checked via the JWT role claim, never inferred from a null uid).
    IF NOT EXISTS (
        SELECT 1 FROM analyses a
        WHERE a.id = p_analysis_id
          AND (a.user_id = auth.uid() OR auth.jwt() ->> 'role' = 'service_role')
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
