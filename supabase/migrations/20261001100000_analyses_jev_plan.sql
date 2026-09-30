-- ADR 037 Addendum A / R3b step 2.3 (Option P1): stores the server-computed
-- Jev plan (K, streamCount, cells, estimateCents, truncatedFallback) so the
-- plan endpoint is idempotent: the plan is written once (conditional update
-- on the row still being plan-less) and a second /plan call returns the
-- STORED plan — it never re-chunks (a retry re-runs cells inside the same
-- matrix; it does not re-chunk, per A2).
--
-- Additive: jsonb nullable, no backfill (rows predating R3b 2.3 simply have
-- no plan; legacy/K=1 behaviour is unchanged). NOT applied by the
-- implementing agent. Applied on merge (own PR, before the 2.3 code).

alter table public.analyses
  add column if not exists jev_plan jsonb;
