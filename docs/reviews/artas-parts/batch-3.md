# ARTAS v3 Batch 3 — Red-Team Audit of PRs #409–#418

Date: 2026-10-08 | Auditor: OC (opencode, GLM-5.3-flash) | Read-only audit per ARTAS v3 protocol (`.memory/ARTAS_REGISTRY.md`).
Scope: merged PRs 409–418 (R3b 2.5/2.6 Jev wave). All "current tree" references checked at HEAD `725dcbc6`.

---

## Findings

| # | PR | Priority | ARTAS Vector Class | Target File | Vulnerability / Impact | Proposed AI Prompt / Remediation |
|---|---|---|---|---|---|---|
| B3-1 | #413 | P2 | V-12 (Cross-Flow Signature Replay) | `web/lib/stream-token.ts:129-200` + `web/app/api/analyses/[id]/plan/route.ts:56-77` | `verifyContentSig` retains a **legacy no-binding branch**: when `binding` is omitted the sig is checked as a bare `hmac(secret, canonicalJson(body))` with **no purpose tag, no resource id, no expiry**. Every `/persist`-family S2S caller that has not yet been migrated to bound signatures can accept a signature replayed cross-flow or indefinitely. The doc comment itself says "Remove the legacy branch once the worker signer is fully deployed" — that removal has not happened, so the cross-flow replay surface is still live in production. Fail-open-by-config: if any caller ever invokes `verifyContentSig` without a binding, replay protection silently disappears. | Grep all `verifyContentSig(` call sites; assert every one passes a `binding`. Then delete the legacy branch (making `binding` required) and update the worker signer if any call path still needs it. Ship behind a one-release grace with a Sentry capture on the legacy branch hit to prove zero traffic before deletion. |
| B3-2 | #413/#415 | P2 | V-07 (Authz Gap: quota-continuation bypass) | `web/app/api/analyses/[id]/stream-tokens/route.ts:57-62` | Token minting is gated on `validation_status === 'processing' && billing_status !== 'completed'`. An analysis left in `processing` after a client crash (before the reaper settles it) lets its owner mint waves of cell tokens (64/wave) that the worker will honor — each grounded cell is a real LLM call — **with no additional quota charge** (quota was consumed once at job creation). Bounded only by the reaper's grace window and per-request wave size; repeated waves during the grace window are unbilled compute. | Add a mint counter: cap cumulative minted cells per analysis (e.g. plan cell count × small tolerance) via a Redis/DB counter keyed by analysisId, enforced in `MintCellTokensUseCase`. Alternatively accept the current design and document the bounded loss window explicitly in the ADR. |
| B3-3 | #410 | P3 | V-03 (State Divergence: partial-restore staleness) | `web/store/useJevRunStore.ts:1-90`, `web/hooks/useSSEStream.ts:1008-1045` | Restore path loads `validation_report.jev_partial_dimensions` into the run store and clears it on analysis switch, but nothing invalidates the restored partials if a **remediation/dimension-recovery job completes for the same analysis while the browser tab stays open** — the grid keeps showing "partial" badges for dimensions that are now complete until the next full refetch. Cosmetic/UX-level (wrong badge, not wrong data), self-heals on reload. | On dimension-remediation completion event (SSE or next fetch of `/api/analyses/[id]`), reconcile `jevRunStore` partial set against the fresh validation report instead of only clearing on analysis switch. |
| B3-4 | #416 | P3 | V-16 (Silent-Write Ambiguity in merge RPC) | `supabase/migrations/20261003010000_merge_analysis_validation_report.sql` | The atomic `merge_analysis_validation_report` RPC is `security definer` with grant to `service_role` only — good — but the webhook caller (`web/app/api/webhooks/validate/route.ts`) treats an RPC failure as a caught/logged error and the sample-run continues as failed; a transient DB error during merge silently drops the validation report portion with no retry queue. Same class as the pre-merge whole-report-wipe incident, just narrower (single report lost vs. wiped). | Add a bounded retry (2–3 attempts, backoff) around the merge RPC call in the webhook handler before marking the run failed; if still failing, capture to Sentry with `phase: 'merge_rpc'` so ops can reconcile. |

No P1 findings. No credential leaks in docs-only PRs #411/#418.

---

## Refuted Candidates

| Candidate | Why refuted (verified on current tree) |
|---|---|
| PR #412: grounded cell claims projective bundle to skip signed slice | Fix present: `worker/src/routes/analysis.ts:299-305` — request `dimensions` must exactly match signed `bundleList[chunkIndex-1]`, and projective bundles are filtered via `isProjectiveBundle` before slice-sha checks (fail-closed `!isV2` rejection at :170). |
| PR #413: forged fields in mint request body | `StreamTokensRequestSchema` is `.strict()`; every signed field comes from stored plan/registry, not the body (`MintCellTokensUseCase` signs from `storedPlan`). |
| PR #415: non-admin user plans K>1 | `gateJevForUser` fails closed; `SupabaseAnalysisAdapter.ts:1026-1046` `isAdminUser` returns false on error; chunks capped at 16 → ≤64 cells = `MAX_CELLS_PER_WAVE` (`web/lib/config/jev.ts:51-52`). |
| PR #409: reaper salvages a genuinely partial chunk set | `analysis-reap-policy.ts:135-150` `chunksAreFullyComplete` requires exact full set 1..TOTAL_STREAMS, all `completed`, all with `dimensions` arrays; K>1 `cellsAreFullyComplete` requires the exact expected cell set. |
| Persist route double side-effects (comment enqueue + embed publish) racing concurrent finalize | Parent finalize is CAS-guarded (`billing_status='processing'` compare-and-swap, comment cites PR #312 post-merge review); comment enqueue deduped via unique constraint → `SupabaseAuxRemediationAdapter.insertSystemCommentSampleRun` maps 23505 to `alreadyQueued: true`. |
| PR #417: time markers from fabricated timestamps | `transcript-time-markers.ts` annotates only real `[HH:MM:SS]` values from timed segments, AFTER the slice-hash check; interval clamped to `JEV_BOUNDS.timeMarkerIntervalSeconds` [5,300] from registry. |
| Docs-only PRs #411/#418 credential leakage | Full diffs scanned; only secret *names* referenced, no values. |
| `.qa-intel/baseline.json` additions in #410/#416 | Lint-baseline noise, not findings. |

---

## Coverage

| PR | Verdict | Notes |
|---|---|---|
| #409 | Refuted-clean | Reaper K>1 salvage paths exact-set checked; embed publish added to markdown path. |
| #410 | Finding B3-3 (P3) | progressOnly verified (`synthesis-stream-adapter.ts:89`, `useSSEStream.ts:938`); restore/clear semantics leave stale partials on in-place remediation. |
| #411 | Clean | Docs/ledger only; no credential leaks. |
| #412 | Refuted-clean | Dual-verify fix confirmed on tree. |
| #413 | Findings B3-1 (P2), B3-2 (P2) | Strict schema + stored-plan signing solid; legacy sig branch and unbilled mint window remain. |
| #414 | Refuted-clean | Degraded-plan marking best-effort try/catch + Sentry; `planToDegrade` only for non-degraded K>1. |
| #415 | Refuted-clean | Admin gate fails closed. |
| #416 | Finding B3-4 (P3) | Merge RPC atomic + `security definer` + service_role-only; webhook has no merge-retry. QStash signature verified before parse. |
| #417 | Refuted-clean | Isomorphic, pure, clamped, post-hash-check annotation. |
| #418 | Clean | Docs/ledger only; no credential leaks. |

Vectors invoked across the batch: V-03, V-07, V-12, V-16 (triggered) plus systematic V-01/V-05/V-09 passes on all HMAC/persist paths (no hits).
