# PR #324 review round — triage table (2026-09-24, OC GLM-5.3-flash low)

Sources: Cubic (3 reviews: 12+3+6 issues), CodeRabbit (8 inline comments), CI checks. CI on head f46fe068: all green — no CI failures to fix.

| id | source | file:line | claim | verdict | action |
|---|---|---|---|---|---|
| F1 | Cubic R3 | docs/agent-prompts/TEMPLATE.md:43 | OC parenthetical garbled, "Flash low)" dangling | VALID | Merged fragment into clean parenthetical naming GLM-5.3-flash (CoreWeave) |
| F2 | Cubic R3 | AGENTS.md:137,141 | OC roster/routing still says DeepSeek v4 Flash, contradicts OC model standard | VALID | Updated roster line + routing text to GLM-5.3-flash/CoreWeave standard |
| F3 | CodeRabbit | CLAUDE.md:54 | Task-fit row says "DeepSeek/GLM" | VALID | Updated to GLM-5.3-flash (CoreWeave, low) with pointer to OC model standard |
| F4 | Cubic R2+R1 (×9 files) | 2026-09-24-oc-{a,b,b2,c,c2,d,e2,tier-step1-round2}.md:43, 2026-09-24-agy-e2e-...:43, 2026-09-19-oc-tier-...:45 | Model-tuning rule says "OC on DeepSeek Flash low" | VALID | All replaced with GLM-5.3-flash (CoreWeave, reasoning low) parenthetical |
| F5 | CodeRabbit | .claude/MEMORY.md:52 | Row 8 path `testsprite TC*.py` wrong (real: `testsprite_tests/`) | VALID | Fixed path (verified TC*.py files live in testsprite_tests/) |
| F6 | CodeRabbit | .claude/MEMORY.md:53 | Row 9 overstates "CVEs patched" — closure unverified | VALID | Reworded: bumped 16.2.11→16.3.3, CVE closure UNVERIFIED until coverage confirmed |
| F7 | Cubic R3 | docs/reviews/2026-09-24-pr321-external-review.md:1 | "addressed in round 2" overstates — P0 tool failures only triaged | VALID | Status amended: P1/P2s addressed, P0 CodeFactor/DeepSource still open |
| F8 | Cubic R3 | docs/reviews/2026-09-24-pr324-external-review.md:2 | P0 + trailing P2/P3 lack disposition markers | VALID | Annotated: P0 WAIVED (infra/free-plan Netlify collision), P2 A/B/D WAIVED (historical dispatch record), P3 WAIVED (style) |
| F9 | Cubic R3 | docs/reviews/2026-09-24-pr325-external-review.md:13 | "plan_tier clamped to `pro`" wrong (CHECK allows free/founder/pro) | VALID | Reworded with actual CHECK constraint and migration path |
| F10 | Cubic R3 | docs/history/THOS_2026-09-24_...md:25 | "hardcoded 25 s handshake" phantom (registry-driven, 15 s default) | VALID | Dropped item from tangent list (only 25 000 ms values are the web-side streaming window) |
| F11 | Cubic R1 | docs/agent-prompts/2026-09-24-oc-d-vector-coverage.md:145 (+ same boilerplate in 10 files incl. TEMPLATE.md) | contract-auditor described as "strict Zod safeParse" but script has no safeParse | VALID | Reworded all 11 copies: grep/AST boundary-pass-through checker, no safeParse call |
| F12 | Cubic R1 | docs/agent-prompts/2026-09-24-agy-e2e-analysis-pipeline-map.md:89 | persist/route.ts LOC stale (1158 vs 1507) | VALID | Updated to 1507 with "remeasure before citing" note (verified: 1507) |
| F13 | Cubic R1 | docs/agent-prompts/2026-09-19-oc-tier-vocabulary-step1-runtime.md:85,88 | updateUserTier line refs off by two; 15-file importer list wrong (5 never import it; ProcessChatMessageUseCase omitted) | VALID | Refs corrected (12/14, SupabasePersistenceAdapter 387 correct); importer list replaced with generated `rg -F "import type { UserTier }" web/` result (10 files incl. ProcessChatMessageUseCase + its Record<UserTier,number> line 24) |
| F14 | CodeRabbit ×4 | 2026-09-24-oc-{b2,c2,e2,tier-step1-round2}.md ~:84 | Negative-control via `git show HEAD:<file> > <file>` risks overwriting uncommitted edits | VALID | Replaced with copy-aside/edit-against-copy/restore-from-copy instruction |
| F15 | Cubic R1 | 2026-09-15-oc-wave-a-security-bulk-triage.md:1,67,113 | Counts don't reconcile; two conflicting branch names | VALID | Counts fixed (~40→~49 title/body/×2, clusters 14/15); branch paragraph rewritten to single instruction (new branch fix/wave-a-security-triage off main, PR #317 untouched) |
| F16 | Cubic R1 | 2026-09-15-oc-wave-a-qaintel-rules.md:4,8 | Bundled multi-phase dispatch + contradictory effort header | VALID | Effort Level line aligned with the existing NOT DISPATCHED banner (rejected original single-dispatch; split + non-Flash routing) |
| F17 | Cubic R1 | 2026-09-24-agy-e2e-...:11, oc-c:59, oc-b2:11, oc-e2:11 | Advisory: bundled Flash-tier dispatches violate routing/split rules | WAIVED | Historical dispatch records, already executed; in-body text now aligned (F4/F16); rewriting scope post-hoc would falsify the record. Re-scope enforcement lives in the banners (wave-a files) and future TEMPLATE.md use |
| F18 | CodeRabbit ×4 | 2026-09-24-oc-*.md §0 | "In short" ledger-protocol summary should be verbatim AGENTS.md §5 | REJECTED | The block opens by mandating AGENTS.md §5 in full as canonical (the summary is an explicitly-labeled pointer beneath it, authored/approved by CC); dropping the pointer adds no fidelity |
| F19 | CI | statusCheckRollup | Failing checks | INVALID | All 35 checks pass on head f46fe068; nothing to fix |

## Gates (all exit 0, unpiped)
- tsc web: 0 errors · tsc worker: 0 errors · lint: 0
- vitest: 165 files, 1722 passed / 16 skipped
- qa-intel --mode diff: exit 0 · --mode full: exit 0 · contract-auditor: exit 0

## Merge with main
`git merge origin/main` — Already up to date (no conflicts).
