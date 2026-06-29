-- Migration: security + RLS init-plan + perf hardening (PR-1)
-- Date: 2026-06-29
-- Audit refs: 10X_FULL_SPECTRUM_REAUDIT_2026_06_29 (D1, D2, D5, D7)
--
-- Scope: pure DB hardening. No data mutation. Idempotent where practical.
-- Verified: reserve_analysis_quota is called ONLY via the service-role client
-- (web/lib/adapters/SupabaseAnalysisAdapter.ts:155), so revoking anon/authenticated
-- EXECUTE does not affect the quota-reservation flow.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) SECURITY (D1): reserve_analysis_quota is SECURITY DEFINER and was executable
--    by anon + authenticated + PUBLIC via PostgREST /rpc. Lock it to service_role.
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.reserve_analysis_quota(uuid, text, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_analysis_quota(uuid, text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reserve_analysis_quota(uuid, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_analysis_quota(uuid, text, text, jsonb) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) PERFORMANCE (D2): wrap auth.uid() in (select auth.uid()) so the planner
--    evaluates it once per query instead of once per row (auth_rls_initplan).
--    Policy bodies are preserved verbatim except for the auth.uid() wrapping.
-- ─────────────────────────────────────────────────────────────────────────────

-- kg_entities
DROP POLICY IF EXISTS "Users can manage entities of their own analyses" ON public.kg_entities;
CREATE POLICY "Users can manage entities of their own analyses" ON public.kg_entities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = kg_entities.analysis_id
      AND analyses.user_id = (select auth.uid())
    )
  );

-- kg_relations
DROP POLICY IF EXISTS "Users can manage relations of their own analyses" ON public.kg_relations;
CREATE POLICY "Users can manage relations of their own analyses" ON public.kg_relations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE analyses.id = kg_relations.analysis_id
      AND analyses.user_id = (select auth.uid())
    )
  );

-- analysis_chunks (SELECT-only; writes are service_role which bypasses RLS)
DROP POLICY IF EXISTS "Users can select their own analysis chunks" ON public.analysis_chunks;
CREATE POLICY "Users can select their own analysis chunks" ON public.analysis_chunks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.analyses
      WHERE public.analyses.id = public.analysis_chunks.analysis_id
      AND public.analyses.user_id = (select auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) PERFORMANCE (D7): covering index for the unindexed FK kg_relations.target_entity_id
--    (the existing composite idx_kg_relations_source_target is source-leading and
--    cannot serve target-only lookups / cascade deletes).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_kg_relations_target_entity
  ON public.kg_relations(target_entity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) INTEGRITY (D5): DEFERRED.
--    Audit assumed a `users_id_fkey` FK existed (NOT VALID) per migration
--    20260607120000. Live prod precheck (2026-06-29) found NO such constraint on
--    public.users — migration-state drift: the file claims an FK that prod lacks.
--    Adding an FK to auth.users on the live pilot DB is a deliberate change, not a
--    PR-1 rider. Tracked separately. (orphan users = 0, so it CAN be added+validated
--    safely later: ALTER TABLE public.users ADD CONSTRAINT users_id_fkey
--    FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;)
-- ─────────────────────────────────────────────────────────────────────────────
