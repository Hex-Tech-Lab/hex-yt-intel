# PR #320 (chapter persist) — external review, 2026-09-24 (head 92cb6a7). Status: addressed in round 2 (807233d6).
- P0 failing checks: CodeFactor, DeepSource web + worker.
- P1 code gated persist to `chunkIndex === 1` while the comment said "first arriving bundle" → chapters lost if bundle 1 fails; contract/comment mismatch.
- P1 middleware exemption relies on the route's own HMAC check, but no route-boundary test proved missing/invalid/wrong-purpose signatures are rejected.
- P1 no worker test for the persist gate (bundle 1 once, 2-5 skip, undefined, non-2xx, rejection).
- P1 Sentry captured non-2xx only; the `catch` (network/timeout/DNS) only console.warn'd.
- P2 `bodySnippet` sent to Sentry not proven bounded/redacted.
- P2 ledger `[IN_PROGRESS]` left in the PR; dispatch prompt said "no PR" but a PR exists.
