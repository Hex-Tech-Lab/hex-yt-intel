# THOS 2026-10-12: UAT Wave

Wave foreman handover. CC was out of quota; the wave was finished by the foreman agent with strict-merge gates.

Verified facts: PRs #467-#485 are merged to `main`. PRs #486-#495 are merged to `uat` only and are pending promotion.

## Merged PRs (2026-10-12, #467-#495)

Merged to `main` (promoted earlier in the day):

| PR | Title |
|---|---|
| 467 | fix(comments): always start the comment sample run so sentiment appears |
| 468 | fix(render): dimension headings, table pipes, timestamp affordances, engagement rate, 18/54/28 |
| 469 | fix(highlights): ticker follows the speaker's own pace (T10) |
| 470 | fix(highlights): clips never replay the previous clip's ending (T8) |
| 471 | fix(render+prompt): Systems as a distinct heading; Dim 7 lists every system |
| 472 | fix(highlights): clips end where the point ends, payoff included (T25) |
| 473 | feat(player): timestamp clicks smooth-scroll the video into view (T15) |
| 474 | feat(highlights): collapsible Highlights Reel (T16) |
| 475 | fix(share): public share page renders dimensions like the dashboard (T23) |
| 476 | fix(render): shorten the insufficient-data placeholder to a muted marker (T24) |
| 477 | feat(dashboard): six compact context cards, adding Comments and Engagement (T11) |
| 478 | fix(chat): report every chat-cascade fallback to Sentry (T22) |
| 479 | fix(chat): sign the relayed chat payload, not just the model list |
| 480 | fix(llm): every OpenRouter call announces its feature in X-Title |
| 481 | feat(chat): route creative-writing requests to Haiku 5.5 on Vertex (T21) |
| 482 | fix(worker): refuse legacy models-only chat signatures |
| 483 | fix(chat): keep the partial answer when a model fails mid-stream |
| 484 | feat(chat): extract hardcoded 50s timeout into Settings Registry (T20) |
| 485 | fix(chat): one cumulative cascade deadline; stop on client disconnect |

Merged to `uat` (not yet on `main`):

| PR | Title |
|---|---|
| 486 | fix(db-security): resolve advisor findings and add cross-boundary token signature test |
| 487 | ci(workflows): configure UAT and production deploy pipeline for worker |
| 488 | docs(ops): plan for a separate UAT database |
| 489 | test(chat): handler-level persistence tests for client_abort |
| 490 | chore(web): clear contract-auditor warnings (T20) 22 -> 9 |
| 491 | chore(dashboard): move default panel widths into Settings Registry (T18) |
| 492 | fix(web): exact Dim 7 placeholder regex; group empty fields on one line (T24) |
| 493 | ci: remove broken deploy-hmac-secret workflow; add HMAC rotation runbook |
| 494 | fix(comments): atomic claim on sample run to prevent duplicate classification + add OpenRouter X-Title headers |
| 495 | refactor(chat): streamChatCascade takes an options object |

## In uat but not in main (promotion pending owner sign-off)

- PRs 486-495 above.
- Migrations only apply on `main` (CI `supabase db push` runs on main). PR 486 (advisor fixes) and PR 491 (Settings Registry panel widths) therefore take effect in production only after promotion.
- PR 494 changes the comment sample run to an atomic claim. It does NOT prevent double paid classification: a retry after a timed-out claim, and the fall-through when every claim attempt fails, can both still run paid classification.
- PR 486's `get_temporal_subgraph` body raises Postgres 42702 (ambiguous `anchor_id`/`depth`) on every call that passes the ownership check. Fixed in a new migration, `20261013100000_fix_get_temporal_subgraph_ambiguous_columns.sql`, which does not edit the merged file. Not applied to any database.

## Open items

- T25 highlight score schema: decision still needed.
- T12, T13, T14: owner UAT checks pending.
- gws console setup: not done.
- Review-bot plans: not yet decided.
- DB split: `docs/ops/db-split-plan.md` (PR 488) recommends a second Supabase project for UAT. Not executed.
- Dimension 7: the `prompt_definitions` table may override code prompts. Verify before trusting code-level prompt changes (PR 471, PR 492).
- Chat cascade and HMAC: PR 493 removes the broken deploy-hmac-secret workflow and adds a rotation runbook. Rotation itself is still an ops task.
- **Pre-go-live gate (open, not done): rotate `STREAM_HMAC_SECRET`.** The owner confirms it has NOT been rotated. Rotation happens only before go-live. Update Vercel and the worker together, in the same change window. This is not a blocker for `uat`.

## Promotion sign-off (owner fills in before promoting `uat` to `main`)

- `uat` SHA checked: `<TO FILL: owner>`
- `main` SHA checked: `<TO FILL: owner>`
- Date and sign-off: `<TO FILL: owner>`

## New process

- Work lands on the `uat` branch first. `main` is promoted from `uat` only with owner sign-off.
- Each OC or AGY task is supervised by a Haiku supervisor. The supervisor watches live logs and diffs, and kills drifting runs (two-strike rule).
- OC model: default `glm-preset/@preset/glm-53-flash-on-cheap` (the server-side OpenRouter preset). Alternate pinned entry: `glm-mb/z-ai/glm-5.3-flash`. This follows the CLAUDE.md "OC model standard". Any change to the OC model, provider, or config must be reported to the owner in the same turn.
- Merges use `scripts/strict-merge.sh` with the bypass list for DeepSource, Codacy, and CodeFactor. Those three checks were ACTION_REQUIRED on every PR this wave and were bypassed explicitly, not ignored silently.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
