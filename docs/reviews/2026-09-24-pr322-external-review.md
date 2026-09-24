# PR #322 (stance dual persistence, AGY) — external review, 2026-09-24 (head 8c159c9). Status: addressed in round 2 (afe276a1, 2036c301) + CC fix c230345c.
- P1 full `analysis_payload` read-modify-write from a stale snapshot (route + backfill) → concurrent writes lost. Fixed with atomic jsonb_set RPC.
- CC-found P1 on the fix itself: SECURITY DEFINER RPC granted to `authenticated` accepted ANY payload key → any user could overwrite any field of own analyses via PostgREST. Fixed: key allowlist.
- P1 valid empty results never persisted (`if (insights.length > 0)`) → paid recompute on every cache expiry.
- P1 Supabase write errors / zero-row updates logged and ignored while the request succeeded.
- P1 backfill fell back from service-role key to anon key → silent 0-row runs under RLS.
- P1 Lint, Pipeline Status, CodeFactor, DeepSource failing.
- P2 full JSONB fetched on Redis cache hits; Redis SET with JSON in URL path + no status check; 100-row hard cap without pagination; blind `]}` JSON repair; ADR test built an in-memory object instead of exercising the route.
