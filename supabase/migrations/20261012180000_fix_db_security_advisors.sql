-- Migration: Fix DB security advisor findings (Stream C)
--
-- Findings addressed:
-- 1. Table `public.analysis_simhash_anchors` has RLS disabled in public schema (ERROR).
--    Audit confirmation:
--    - Written only by SupabaseTemporalGraphAdapter.storeSimHashAnchors (service-role client).
--    - Read only by SupabaseTemporalGraphAdapter.resolveAnchorByHammingDistance (service-role client).
--    - Traversed only by get_temporal_subgraph RPC (SECURITY DEFINER, checked via JWT service_role or owner).
--    - No client/browser code directly queries public.analysis_simhash_anchors.
--    Remediation:
--    - Enable Row Level Security (RLS) on public.analysis_simhash_anchors with no public policies.
--    - Revoke all privileges from anon, authenticated, public.
--    - Grant SELECT, INSERT, UPDATE, DELETE on public.analysis_simhash_anchors to service_role.
--
-- 2. `public.merge_analysis_payload_key(uuid, text, jsonb)` is SECURITY DEFINER and executable
--    by authenticated role.
--    Audit confirmation:
--    - Called by client-authenticated requests via SupabaseAnalysisPayloadAdapter in
--      web/app/api/analyses/[id]/relations/route.ts for stance_relations.
--    - Function definition already strictly enforces:
--        a. p_key allowlist ('stance_relations' only).
--        b. set search_path = ''.
--        c. strict caller ownership: auth.role() = 'service_role' OR
--           (auth.uid() IS NOT NULL AND a.user_id = auth.uid()).
--    - Reassert security definer posture and keep explicit grants documented.
--
-- 3. `public.get_temporal_subgraph(uuid)` is SECURITY DEFINER and executable by authenticated role.
--    Audit confirmation:
--    - Called exclusively by SupabaseTemporalGraphAdapter.queryTemporalSubgraph via service-role client.
--    - No client-authenticated route calls get_temporal_subgraph directly.
--    - search_path was 'public' instead of empty/explicit.
--    Remediation:
--    - Update function definition to set search_path = ''.
--    - Revoke execute from authenticated, anon, public.
--    - Grant execute only to service_role.
--
-- 4. `public.admin_list_users_activity()` is SECURITY DEFINER and executable by authenticated role.
--    Audit confirmation:
--    - Called by web/app/api/admin/users/route.ts under the caller's authenticated Supabase client.
--    - Gated at Next.js route boundary via requireAdmin('admin/users:GET').
--    - Function body already contains internal admin gate:
--        if not exists (select 1 from public.users where public.users.id = auth.uid() and public.users.role = 'admin') then raise exception 'forbidden';
--    - search_path was 'public', 'auth'. Update to set search_path = '' and fully schema-qualify tables.

-- (a) Enable RLS and lockdown public.analysis_simhash_anchors
ALTER TABLE public.analysis_simhash_anchors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.analysis_simhash_anchors FROM anon, authenticated, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.analysis_simhash_anchors TO service_role;

-- (b) get_temporal_subgraph: restrict to service_role and harden search_path
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
    SELECT DISTINCT ON (anchor_id) * FROM subgraph
    ORDER BY anchor_id, depth ASC
    LIMIT 24; -- ROE bound <=24 nodes
END;
$$;

REVOKE ALL ON FUNCTION public.get_temporal_subgraph(UUID) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.get_temporal_subgraph(UUID) TO service_role;

-- (c) admin_list_users_activity: harden search_path with strict internal admin check
CREATE OR REPLACE FUNCTION public.admin_list_users_activity()
RETURNS TABLE(
  id uuid,
  email text,
  name text,
  tier text,
  role text,
  created_at timestamp with time zone,
  analyses_count bigint,
  last_analysis_at timestamp with time zone,
  last_session_at timestamp with time zone,
  last_session_ip text,
  last_session_user_agent text,
  total_cost_usd numeric,
  total_tokens_used bigint,
  analysis_turns bigint,
  analysis_cost_usd numeric,
  chat_turns bigint,
  chat_cost_usd numeric,
  remediation_turns bigint,
  remediation_cost_usd numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE public.users.id = auth.uid() AND public.users.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.name,
    u.tier,
    u.role,
    u.created_at,
    COALESCE(a.analyses_count, 0) AS analyses_count,
    a.last_analysis_at,
    s.last_session_at,
    s.last_session_ip,
    s.last_session_user_agent,
    COALESCE(c.total_cost_usd, 0) AS total_cost_usd,
    COALESCE(c.total_tokens_used, 0) AS total_tokens_used,
    COALESCE(c.analysis_turns, 0) AS analysis_turns,
    COALESCE(c.analysis_cost_usd, 0) AS analysis_cost_usd,
    COALESCE(c.chat_turns, 0) AS chat_turns,
    COALESCE(c.chat_cost_usd, 0) AS chat_cost_usd,
    COALESCE(c.remediation_turns, 0) AS remediation_turns,
    COALESCE(c.remediation_cost_usd, 0) AS remediation_cost_usd
  FROM public.users u
  LEFT JOIN LATERAL (
    SELECT count(*) AS analyses_count, max(analyses.created_at) AS last_analysis_at
    FROM public.analyses
    WHERE analyses.user_id = u.id
  ) a ON TRUE
  LEFT JOIN LATERAL (
    SELECT sessions.updated_at AS last_session_at, sessions.ip::text AS last_session_ip, sessions.user_agent AS last_session_user_agent
    FROM auth.sessions
    WHERE sessions.user_id = u.id
    ORDER BY sessions.updated_at DESC
    LIMIT 1
  ) s ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(sum(cost_usd), 0) AS total_cost_usd,
      COALESCE(sum(tokens_used), 0) AS total_tokens_used,
      count(*) FILTER (WHERE usage_logs.action IN ('analysis_completed', 'analysis')) AS analysis_turns,
      COALESCE(sum(cost_usd) FILTER (WHERE usage_logs.action IN ('analysis_completed', 'analysis')), 0) AS analysis_cost_usd,
      count(*) FILTER (WHERE usage_logs.action = 'chat_turn') AS chat_turns,
      COALESCE(sum(cost_usd) FILTER (WHERE usage_logs.action = 'chat_turn'), 0) AS chat_cost_usd,
      count(*) FILTER (WHERE usage_logs.action = 'dimension_remediation') AS remediation_turns,
      COALESCE(sum(cost_usd) FILTER (WHERE usage_logs.action = 'dimension_remediation'), 0) AS remediation_cost_usd
    FROM public.usage_logs
    WHERE usage_logs.user_id = u.id
      AND usage_logs.action IN ('analysis_completed', 'analysis', 'chat_turn', 'dimension_remediation')
  ) c ON TRUE
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users_activity() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_list_users_activity() TO authenticated, service_role;
