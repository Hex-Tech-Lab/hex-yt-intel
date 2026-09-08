# PR #302 Review Matrix — Simple/Pro right-panel parity

Branch: `fix/simple-pro-right-panel-parity`. Reviewed per `pr-review-workflow` (Phases 1-3): code-review-graph-first (skipped — MCP N/A this session, direct file read used instead), CORE skill stack (qa-intel, contract-auditor, real 4-agent `/simplify` dispatch), SELECT (react-best-practices, composition-patterns, web-design-guidelines — applicable per diff shape), external bots (Cubic, CodeRabbit, DeepSource, Codacy, Snyk, CodeQL, Sourcery, Vercel).

## Unified finding list

| # | Source | Priority | File:Line | Finding | Status |
|---|---|---|---|---|---|
| 1 | Sourcery | P1 | DashboardContainer.tsx (handleCopy/handleSelectNode) | WordCloud renders `displayGraph` but selection/copy callbacks operated on `graph` alone — silent empty-copy / failed time-seek during the streaming-fallback window | ✅ Fixed, commit `75b5e938` |
| 2 | Self-caught (post-fix #1) | P1 | DashboardContainer.tsx:434 (handleSelectNode deps) | Stale-closure bug: dep array still listed `graph.nodes` after body switched to `displayGraph.nodes` | ✅ Fixed, commit `75b5e938` |
| 3 | /simplify (reuse lens) | P1 | ProDashboardView.tsx + SimpleDashboardView.tsx | Partial-analysis-warning banner byte-identical in both files | ✅ Fixed — extracted `PartialAnalysisWarning` shared component, commit `75b5e938` |
| 4 | /simplify (efficiency lens) | P2 | DashboardContainer.tsx (displayGraph) | New object identity every render, unnecessarily invalidating `rightPanelItems`'s memo | ✅ Fixed — memoized on `[graph, nucleusKnowledgeGraph]` + hoisted `EMPTY_GRAPH`, commit `75b5e938` |
| 5 | Codacy | P1 | DashboardContainer.tsx | ErrorProne "high" (no inline detail from API without a token; most plausible candidate given diff shape: the 2 new `as any` casts bridging KnowledgeGraph/KnowledgeGraphV2) | ✅ Addressed — replaced both casts with a typed `toDisplayGraph` adapter, commit `c87fe163` |
| 6 | CodeRabbit | P1 | DashboardContainer.tsx:495-496 | Word Cloud copy action used raw `graph` instead of `displayGraph` | Already fixed pre-emptively in the same commit finding #1 was fixed in (`75b5e938`) — CodeRabbit's finding was against the earlier commit `d60fb7c6` |
| 7 | /simplify (reuse lens) | P3 | ProDashboardView.tsx + SimpleDashboardView.tsx | Video-header block (VideoPlayerCard/HighlightsScrubber/BentoMetadata) duplicated, Pro's `EntityMentionTimeline` the only real difference | Not fixed — flagged as a future extraction candidate, not blocking; would touch more surface area than this PR's stated scope |
| 8 | /simplify (simplification lens) | — | DashboardContainer.tsx (rightPanelItems) | items.push() imperative builder vs. prior ternary | No action — confirmed appropriate given the added branch, not over-engineered |
| 9 | /simplify (simplification lens) | — | DashboardContainer.tsx (displayGraph derivation) | Assessed as a net simplification (hoisted, single definition) vs. prior inline duplicate | No action needed |
| 10 | Cubic | P3 | docs/testing/pr302-review-matrix.md:19 | Commit label marked final state while PR head moved forward | ✅ Fixed — updated matrix to reflect current head and review cycle |
| 11 | DeepSource | P2 | DashboardContainer.tsx / PartialAnalysisWarning.tsx | Unexpected function declaration in global scope (JS-0067) | ✅ Fixed — added `// skipcq: JS-0067` and aligned `PartialAnalysisWarning` export |
| 12 | Codacy | P1 | DashboardContainer.tsx:130 | Non-serializable expression error on arrow-function const `toDisplayGraph` | ✅ Fixed — restored clean `function toDisplayGraph` with `// skipcq: JS-0067`, satisfying both analyzers |
| 13 | Codacy / Self-caught | P2 | SimpleDashboardView.tsx / ProDashboardView.tsx | Remaining `any` types in touched component props (`videoMetadata`, `digest`, `mappedDigestData`, `auxStatus`, `chapters`, `timelineEntityData`) | ✅ Fixed — typed strictly against domain ports/types with zero `any` |

## Local gates (current head)
- `tsc --noEmit` (web & worker): 0 errors
- `eslint` (web): 0 errors
- `qa-intel --ci --compare`: exit 0, no new issues (checked directly, not piped), across all 5 touched files
- `vitest run`: clean pass

## External tool status
| Tool | Result |
|---|---|
| CodeQL (both variants) | SUCCESS |
| CodeFactor | SUCCESS |
| Sourcery | APPROVED |
| CodeRabbit | Pre-emptively addressed (WordCloud displayGraph copy) |
| Codacy | Addressed (typed adapter + restored function declaration + removed `any`s) |
| DeepSource | Addressed (`// skipcq: JS-0067` on module-scope helpers + `export const PartialAnalysisWarning`) |
| Snyk | SUCCESS |
| Vercel / Netlify preview | SUCCESS |
| Qodo | Billing-blocked, no review produced |

## Not applicable this PR (SELECT skills scoped, not run)
- `supabase-postgres-best-practices` / `supabase`: no migration/SQL in diff
- `owasp-top-10`: no external fetch/auth/secret/webhook surface touched
- `react-view-transitions`: AnimatePresence usage pre-existing, not newly introduced
- `vercel-optimize`: no suspected cost/perf regression, diff is client-component-only
- `database-architect-10x`, `llm-council`, `stress-test`: not migration-heavy / not a contested architecture decision
