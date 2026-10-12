-- Fix: get_temporal_subgraph raised Postgres 42702 (ambiguous column reference) on every
-- call that passed the ownership check. The RETURNS TABLE OUT parameters `anchor_id` and
-- `depth` clash with the bare column names in the final DISTINCT ON / ORDER BY. Qualify
-- both with the CTE alias. Signature, SECURITY DEFINER, search_path, and grants are unchanged.
-- Supersedes the function body from 20261012180000_fix_db_security_advisors.sql (merged to uat, not applied to main).

CREATE OR REPLACE FUNCTION public.get_temporal_subgraph(p_analysis_id UUID)
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
SET search_path = ''
AS $$
BEGIN
    -- Enforce ownership mapping: owner, or a genuine service-role caller
    -- (checked via the JWT role claim, never inferred from a null uid).
    IF NOT EXISTS (
        SELECT 1 FROM public.analyses a
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
        FROM public.analysis_simhash_anchors a
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
        FROM public.analysis_simhash_anchors a
        INNER JOIN subgraph sg ON a.analysis_id = p_analysis_id
                               AND (a.window_start >= sg.window_end AND a.window_start < sg.window_end + 30)
        WHERE sg.depth < 3  -- ROE bound on traversal depth
    )
    SELECT DISTINCT ON (subgraph.anchor_id) subgraph.*
    FROM subgraph
    ORDER BY subgraph.anchor_id, subgraph.depth ASC
    LIMIT 24; -- ROE bound <=24 nodes
END;
$$;

REVOKE ALL ON FUNCTION public.get_temporal_subgraph(UUID) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_temporal_subgraph(UUID) TO service_role;
