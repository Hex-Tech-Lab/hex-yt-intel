# PR #324 (restore/.mcp/docs) — external review, 2026-09-24 (head b4b627a). Status: addressed (143f87ca), one finding rejected.
- P0 Netlify failing (free-plan concurrent builds). WAIVED — infra/free-plan limitation, not a code defect; Netlify 'Pages changed' is skip-only for docs diffs.
- P1 `code-review-graph` invoked unpinned via uvx → supply-chain/tooling drift. Fixed: pinned @2.3.9.
- P1 security bulk-triage prompt: cluster counts didn't reconcile; contradictory branch names. Fixed: NOT-DISPATCHED banner.
- P1 tier step-1 prompt: hand-written UserTier importer list was wrong. Fixed: historical note; round 2 required a generated list.
- P2 qa-intel-rules prompt: medium effort + Flash + multi-step scope contradiction. Fixed: banner.
- P2 e2e map routed to Flash — REJECTED (user's explicit choice; CC reviews output).
- P2 ledger dispatch count ("3 OC runs") didn't match 4 prompts. Fixed: correction entry.
- P2 A/B/D prompts bundle measure+fix+verify; B lacked an idempotency contract before dedupe. WAIVED — historical dispatch record; prompts already executed; re-scoping post-hoc would falsify the record.
- P3 dated status docs need as-of/owner/expiry. WAIVED — style suggestion; not actionable on already-archived docs.
