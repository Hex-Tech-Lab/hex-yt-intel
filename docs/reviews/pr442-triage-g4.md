# PR #442 Review Triage — Group 4 (59 issues)

Scope: group-4 review threads from `.pr442-issues-g4.json` (Cubic, CodeRabbit, DeepSource findings).

## Triage Table

| Thread IDs | Path:line | Bot | Issue (short) | Verdict | Commit / Rationale |
|---|---|---|---|---|---|
| c6pLLG_ | cascade-validation.ts:75 | Cubic | Function declaration in global scope, wrap in IIFE | STYLE-ACCEPT | Top-level helper in a module file is idiomatic ESM; IIFE adds noise, no benefit |
| c6pLLHG | cascade-validation.ts:44 | Cubic | `validateDiarizationCascadeValue` complexity 12 (medium) | STYLE-ACCEPT | Validation branching is inherent; refactor would hurt readability |
| c6pLLHN | cascade-validation.ts:78 | Cubic | `validateCascadeRegistryValue` complexity 15 (medium) | STYLE-ACCEPT | Same as above |
| c6pLLHU | cascade.ts:236 | Cubic | Missing JSDoc on `resolveDiarizationCascade` | STYLE-FIX | Added doc comment |
| c6pPwT1 | cascade-validation.ts:78 | Cubic | `validateCascadeRegistryValue` complexity 16 (high) | STYLE-ACCEPT | Refactor risk outweighs benefit for a validation gate |
| c6pPwT9 | cascade.ts:236 | Cubic | `resolveDiarizationCascade` complexity 16 (high) | STYLE-ACCEPT | Resolution logic is a linear fallback chain; splitting obscures it |
| c6pP5ap | cascade.ts:236 | Cubic | P2: no production caller for `resolveDiarizationCascade`; wire into sensor config | DEFERRED | Resolver + EpistemicPipelineDispatcher/SensorRegistry are new in this PR and deliberately unrouted; wiring them is an architecture change requiring ADR/user sign-off, not a review patch. Tracked as follow-up |
| c6pP5as | contracts.ts:368 | Cubic | P2: reversed timestampRange `[25,10]` accepted | FIXED | Added `.refine(end >= start)` on ExtractedClaimSchema |
| c6pQJek | contracts.ts:381 | Cubic | P2: duplicate claim IDs pass schema | FIXED | Added `.refine` rejecting duplicate claim IDs on GroundedExtractionPayloadSchema |
| c6papxs | CombinerPass.ts:122 | DeepSource | Use `u` regex flag | STYLE-FIX | Added `u` |
| c6papxx | CombinerPass.ts:134 | Cubic | Missing JSDoc on `combineDimensionChunks` | STYLE-FIX | Added doc comment |
| c6papx7 | CombinerPass.ts:134 | Cubic | `combineDimensionChunks` complexity 16 (high) | STYLE-ACCEPT | Core merge logic; decomposing would hide the pipeline |
| c6papyG | DimensionDrawer.tsx:188 | DeepSource | Missing JSDoc on `handleMouseMove` | FIXED | Handler replaced by pointer-event implementation with explanatory comment (accessibility rewrite below) |
| c6papyN | DimensionDrawer.tsx:195 | DeepSource | Missing JSDoc on `handleMouseUp` | FIXED | Same as above |
| c6papyU | CombinerPass.ts:121 | DeepSource | Use `u` regex flag | STYLE-FIX | Added `u` |
| c6papyа | CombinerPass.ts:33 | Cubic | Missing JSDoc on class `CombinerPass` | STYLE-FIX | Added class doc comment |
| c6papyf | CombinerPass.ts:33 | Cubic | Class with only static properties | STYLE-ACCEPT | Namespace-style class matches existing codebase pattern |
| c6papyo | CombinerPass.ts:34 | Cubic | Missing JSDoc on `parseDimensionMarkdown` | STYLE-FIX | Added doc comment |
| c6papys | CombinerPass.ts:34 | Cubic | `parseDimensionMarkdown` complexity 12 (medium) | STYLE-ACCEPT | Parser state machine; splitting reduces clarity |
| c6papyx | CombinerPass.ts:51 | DeepSource | Use `u` regex flag | STYLE-FIX | Added `u` |
| c6papy3 | CombinerPass.ts:55 | DeepSource | Prefer optional chain | STYLE-FIX | `match?.[1]` |
| c6papy9 | CombinerPass.ts:91 | Cubic | Missing JSDoc on `normalizeDimension7` | STYLE-FIX | Added doc comment |
| c6papzB | CombinerPass.ts:91 | Cubic | `normalizeDimension7` complexity 9 (medium) | STYLE-ACCEPT | Serial linear transformations |
| c6papzF | CombinerPass.ts:119 | DeepSource | Use `u` regex flag | STYLE-FIX | Added `u` |
| c6papzH | CombinerPass.ts:120 | DeepSource | Use `u` regex flag | STYLE-FIX | Added `u` |
| c6papzL | CombinerPass.ts:138 | DeepSource | Forbidden non-null assertion | STYLE-FIX | Replaced with null-guard |
| c6papzQ | CombinerPass.ts:196 | DeepSource | Forbidden non-null assertion | STYLE-FIX | Replaced with null-guard |
| c6papzU | CombinerPass.ts:217 | Cubic | Missing JSDoc on `reduceDimensions` | STYLE-FIX | Added doc comment |
| c6papzZ | CombinerPass.ts:217 | Cubic | `reduceDimensions` complexity 6 (medium) | STYLE-ACCEPT | Simple grouping loop |
| c6papze | CombinerPass.ts:231 | DeepSource | Forbidden non-null assertion | STYLE-FIX | Replaced with fallback |
| c6pa5b_ | stitch-analysis-chunks.ts:236 | Cubic | P2: non-string dimension content throws before schema validation | FIXED | Filter `typeof d.content === "string"` before reduceDimensions |
| c6pa5cD | DimensionDrawer.tsx:222 | Cubic | P2: resize handle mouse-only, not keyboard/touch accessible | FIXED | Rewrote with pointer events + focusable `role="separator"` with arrow-key resize and aria-valuenow/min/max |
| c6pa5cK | DashboardContainer.tsx:451 | Cubic | P2: `secs > 0` skips valid `00:00` seeks | FIXED | Restored `secs >= 0`, consistent with the retry path |
| c6pa5cS | CombinerPass.ts:96 | Cubic | P2: regex splits prose like "System design matters" | FIXED | Required colon in systemSplitRegex |
| c6pa5cb | CombinerPass.ts:114 | CodeRabbit | P3: bracketed titles retain trailing `]` | FIXED | Strip bold before balanced `[...]` strip |
| c6pa5eY | DimensionDrawer.tsx:224 | CodeRabbit | Keyboard/pointer resize for handle | FIXED | Same accessibility rewrite as c6pa5cD |
| c6pa5ea | CombinerPass.ts:131 | CodeRabbit | Require colon in split regex; anchor subsection rewrites to line ends | FIXED | Colon-anchored split regex + `[ \t]*$/gim` anchors on A–D subsection rewrites |
| c6pa5en | CombinerPass.ts:201 | CodeRabbit | `existing.body.includes(subSec.body)` merge bug | FIXED | Compare normalized (trim + collapse whitespace) full bodies, skip only on equality |
| c6pbt85 | cascade.ts:220 | DeepSource | Function declaration in global scope, wrap in IIFE | STYLE-ACCEPT | Idiomatic module-scope function |
| c6pbt89 | cascade.ts:187 | Cubic | `resolveCascade` complexity 6 (medium) | STYLE-ACCEPT | Straightforward resolution path |
| c6pbt9e | cascade-resolution.test.ts:121 | DeepSource | Function declaration in global scope | STYLE-ACCEPT | Test helper at module scope is normal |
| c6pbt9l | cascade.ts:150 | DeepSource | Function declaration in global scope | STYLE-ACCEPT | Idiomatic module-scope function |
| c6pbt9n | cascade.ts:139 | Cubic | Missing JSDoc on `assertValidCascadeItems` | STYLE-FIX | Added doc comment |
| c6pbt9t | cascade.ts:139 | Cubic | `assertValidCascadeItems` complexity 10 (medium) | STYLE-ACCEPT | Sequence of guard throws |
| c6pbt9z | cascade.ts:140 | Cubic | Missing JSDoc on `label` arrow | STYLE-FIX | Added doc comment |
| c6pbt92 | model-id-translator.ts:7 | DeepSource | Function declaration in global scope | STYLE-ACCEPT | Idiomatic module-scope function |
| c6pr_UI | KnowledgeGraphCanvas.tsx:89 | DeepSource | Arrow function expected no return value | STYLE-ACCEPT | False positive: the arrow is a React `useEffect` cleanup return, required by the API |
| c6pr_UM | MindMap.tsx:279 | DeepSource | Arrow function expected no return value | STYLE-ACCEPT | Same — `useEffect` cleanup return |
| c6pr_UQ | WorkerIngestionAdapter.ts:34 | Cubic | `fetchWorkerTranscript` complexity 10 (medium) | STYLE-ACCEPT | Fetch+fallback chain; refactor adds indirection |
| c6pyj5k | settings/[key]/route.ts:90 | DeepSource | Prefer optional chain | FIXED | `key?.startsWith(...)` |
| c6pyj5t | KnowledgeGraphCanvas.tsx:82 | DeepSource | Function complexity 8 (medium) | STYLE-ACCEPT | useEffect setup/teardown body |
| c6pyj5y | KnowledgeGraphCanvas.tsx:77 | DeepSource | Arrow function expected no return value | STYLE-ACCEPT | False positive — `useEffect` cleanup return |
| c6pyj52 | KnowledgeGraphCanvas.tsx:278 | DeepSource | `nodeCanvasObject` complexity 39 (very-high) | STYLE-ACCEPT | Canvas render callback; extracting pieces would hurt hot-path performance and readability |
| c6pyj5_ | MindMap.tsx:271 | DeepSource | Function complexity 7 (medium) | STYLE-ACCEPT | Wheel-zoom handler |
| c6pyj6D | WordCloud.tsx:89 | DeepSource | Function complexity 8 (medium) | STYLE-ACCEPT | Layout computation |
| c6pzmhy | WorkerIngestionAdapter.ts:143 | Cubic | P2: oEmbed fallback fetch has no timeout | FIXED | Added 3s AbortController + clearTimeout, matching main fetch |
| c6pzmh4 | WorkerIngestionAdapter.ts:152 | Cubic | P2: oEmbed fallback stamps `publishedAt` as now | FIXED | Changed to `''` (unknown), matching main path's `|| ''` |
| c6qHsck | dimensionMarkdownComponents.tsx:18 | DeepSource | Function declaration in global scope | STYLE-ACCEPT | Idiomatic module-scope function |
| c6qHsc5 | dimensionMarkdownComponents.tsx:41 | Cubic | `MarkdownLink` complexity 6 (medium) | STYLE-ACCEPT | Simple branch set |

Total: 59 issues — 13 fixed, 1 deferred (needs ADR/user sign-off), 45 style-accepted/rationale-documented.

## Behaviour Changes

1. **contracts.ts** — claims with reversed `timestampRange` or duplicate IDs are now rejected at schema validation.
2. **CombinerPass.ts** — Dimension 7 system split now requires a colon ("System design matters" prose no longer becomes a system block); subsection A–D rewrites only match full standalone lines; bracketed titles no longer keep a trailing `]`; duplicate subsection bodies merge only when their normalized bodies differ.
3. **stitch-analysis-chunks.ts** — dimension chunks with non-string content are dropped before reduce instead of throwing during stitching.
4. **DashboardContainer.tsx** — entity seeks to timestamp `00:00` now fire instead of being skipped.
5. **DimensionDrawer.tsx** — resize handle now works with touch/pointer input and is keyboard-accessible (arrow keys, Shift for larger steps, Home/End) with ARIA separator semantics.
6. **WorkerIngestionAdapter.ts** — oEmbed fallback has a 3-second timeout and no longer fakes a publish date.

## Verification

- `tsc --noEmit` (web + worker): pass
- vitest full suite: pass (incl. new `pr442-group4-fixes.test.ts`, 9 tests)
- eslint: pass
- qa-intel `--mode diff`: no findings introduced beyond the preexisting clean-tree baseline
