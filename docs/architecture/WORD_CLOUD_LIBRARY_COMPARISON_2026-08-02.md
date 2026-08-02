# Word Cloud: Library Comparison (2026-08-02)

Context: `web/components/templates/console/WordCloud.tsx` is an in-house, canvas-based
word cloud with a custom collision-free Archimedean-spiral placement algorithm. During
the 2026-08-02 session it was extended to open by default during analysis and animate
words in via `requestAnimationFrame` + cubic ease-out (scale/alpha stagger). The user
asked whether a library-based approach (starting from a suggested `d3` + `d3-cloud`
snippet) would be better. This doc is the researched answer.

## Comparison

| Dimension | 1. In-house canvas + spiral (current) | 2. d3 + d3-cloud (SVG) | 3. `wordcloud2.js` (maintained canvas lib) |
|---|---|---|---|
| **Bundle size (added, gzip est.)** | **0 KB** — already shipped, zero new deps | `d3` core already in `web/package.json` (~25KB gz used subset), but `d3-cloud` itself is **not installed**; adds ~4-5 KB gz (unmaintained since 2021, no official types → extra `@types` shim or `any`) | ~6-8 KB gz standalone, zero transitive deps (no d3 needed at all) |
| **Rendering method** | Canvas 2D, imperative draw loop | SVG `<text>` nodes, one per word, React-rendered | Canvas 2D (own layout engine, similar spiral approach) |
| **Animation / incremental reveal** | Already built this session: RAF + cubic ease-out scale/alpha stagger, fully custom control | Natural fit — SVG elements animate via CSS transitions/Framer Motion/d3-transition per node; typically *easier* to stagger than canvas | Library owns the canvas paint loop; no built-in per-word enter animation — would need to fork/wrap it, similar retrofit cost to option 1 |
| **Collision handling quality** | Custom Archimedean spiral, tuned to this app's chip/rounded-rect word shapes (uses `--radius-control`) — already proven and shipped | d3-cloud's original spiral algorithm (same lineage) but tuned for arbitrary-rotation text, not chip shapes — would need to strip rotation and re-adapt padding logic | Same spiral family, sitting inside an opaque library — collision tuning requires patching library internals or living with defaults |
| **Maintenance burden** | Team owns 100% — bug is always your bug, but no dep-update surprises, no supply-chain risk | `d3-cloud` (jasondavies) has had **no real release since ~2016-2021**, single-maintainer, GitHub issues unanswered for years — adding it means importing dead code with a live-dep footprint | Actively maintained fork (`timdream/wordcloud2.js`) but still low-velocity (sporadic releases); still an external dependency to track for security advisories |
| **TypeScript support** | Full — it's your code | Weak — no official `@types/d3-cloud`; community types are stale/incomplete, expect `any` casts at the layout boundary | None official; would need hand-rolled `.d.ts` or `any` |
| **Mobile/touch performance** | Canvas repaint is cheap per-frame; already tuned to `ResizeObserver` container width | SVG with many `<text>` nodes degrades faster on low-end mobile (DOM cost per word) — for typical word-cloud counts (~30-60 words) this is usually fine, but strictly worse than canvas at scale | Canvas — comparable to option 1, no DOM node cost |
| **Ease of extending (click-to-filter)** | **Already implemented** — `onSelect(id)` prop wired directly into the hit-test on canvas coordinates | Natural — each word is a real DOM `<text>` node, so `onClick` is trivial, arguably the easiest of the three | Harder — canvas hit-testing must be reimplemented on top of the library's internal layout output (library doesn't expose click callbacks with app-level IDs cleanly) |
| **License** | N/A (in-house) | BSD-3-Clause (d3-cloud) / ISC (d3) | MIT |

## Recommendation

**Keep and extend the in-house canvas implementation (Option 1).** It already does
everything the alternatives would need to be adapted for — click-to-filter via
`onSelect`, DPI-aware canvas sizing, chip-shaped collision padding tied to the design
system's `--radius-control`/`--ink` tokens, and (as of this session) staggered RAF
entrance animation — at zero incremental bundle cost, which matters given the team is
already bundle-size-sensitive post-ADR-017 (`docs/specs/ADR_017_DASHBOARD_BUNDLE_ZOD_REGRESSION_2026-07-29.md`).

`d3-cloud` (Option 2) is attractive only in isolation: its actual maintenance status is
poor (essentially unmaintained since the early 2020s) and its rotation/SVG-text layout
model doesn't match this app's rounded-chip word rendering, so migrating would mean
throwing away working collision/animation/click logic to re-derive it against a
worse-typed, less-maintained dependency — a net regression, not a simplification.

`wordcloud2.js` (Option 3) is the more defensible external option if the in-house code
ever becomes a genuine maintenance drag, since it stays canvas-based and
dependency-free, but today it would still mean giving up the already-shipped animation
and click-to-filter integration for no bundle or capability win.

**Net: no migration is justified right now.** Revisit only if the in-house spiral
algorithm itself becomes a bottleneck (e.g., very large word counts, >200 entities)
that a dedicated library demonstrably handles better.
