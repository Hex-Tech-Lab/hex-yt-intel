# ADR 017: `/dashboard` Client Bundle — Zod-Driven 535KB Chunk

**Date**: 2026-07-29
**Status**: INVESTIGATED — root cause confirmed, remediation not yet implemented
**References**: `docs/specs/ADR_006_STRUCTURED_JSON_STREAMING_2026-06-06.md` (Zod schema usage), Speed Insights RES decline (Jul 23 → Jul 29, ~90 → ~50)

---

## 1. Executive Summary

`/dashboard`'s production Real Experience Score has declined from ~90 to ~50 over the trailing week, with FCP (3.34s, poor) and LCP (4.13s, needs improvement) as the worst-scoring metrics. `web/scripts/enforce-bundle.mjs` has been flagging a 535.65KB client chunk against its own 250KB threshold. Investigated via `next experimental-analyze` (Next.js 16's Turbopack-native bundle analyzer — `@next/bundle-analyzer` does not work under Turbopack builds, which this app uses) with real per-module byte attribution, not string-grep inference.

### Key Finding

**Zod (v4.4.3) accounts for 276.5KB of the 534.2KB chunk — 52% of it** — because `web/store/useInputStore.ts` (a Zustand store, client-side by construction) imports `zod` directly, pulling the full library into `/dashboard`'s client bundle. Zod v4 is materially heavier than v3 (new validation core, locale machinery); this app pinned to `zod@4.4.3`.

App-authored code accounts for the next-largest share (~100KB across `AnalysisHistory.tsx`, `ChatDock.tsx`, `DashboardContainer.tsx`, and others) but no single app file approaches Zod's footprint.

### Not the cause (ruled out with evidence)

- **Today's Framer Motion additions** (right panel, chat drawer, sidebar, hero, accordion motion) — measured via checkout-and-rebuild bundle diff against the pre-change commit: **+7.2KB total**, not a meaningful contributor. Framer Motion was already forced into `/dashboard`'s critical path since 2026-06-03 via `BentoMetadata.tsx`.
- **`three`** — present in `next.config.ts`'s `optimizePackageImports` list but not imported anywhere in the codebase (dead config entry, confirmed via `grep`).
- **d3-force, pdfkit, react-markdown, date-fns, Stripe, PDFKit** — zero matches in the target chunk.
- **This session's icon-bundling fix** (`0bf3da10`) — zero matches for `solar-subset`/`addCollection` in the chunk; unrelated.

---

## 2. Investigation Method

1. Attempted `@next/bundle-analyzer` (webpack-based) — silently produces no report under this app's Turbopack production build. Next.js's own CLI output pointed to the correct tool: `next experimental-analyze`.
2. Ran `pnpm exec next experimental-analyze -o` (headless, writes to `.next/diagnostics/analyze/` instead of starting an interactive server).
3. Parsed the resulting `data/dashboard/analyze.data` binary (4-byte big-endian length prefix + JSON payload: `sources`, `chunk_parts` {source_index, output_file_index, size, compressed_size}, `output_files`).
4. Identified the target output file (`[client-fs]/_next/static/chunks/29aqk7js6-nfb.js`, 534.2KB — matches the 535.65KB flagged by `enforce-bundle.mjs` in the normal build; hash differs between analyze and normal builds, size does not).
5. Resolved each `chunk_parts` entry's `source_index` through its `parent_source_index` chain to reconstruct full module paths (the `sources` array stores only leaf filenames per node).
6. Aggregated bytes by top-level `node_modules` package name across all 199 source parts feeding this chunk.

This produced real per-package byte attribution, superseding an earlier, less reliable string-grep pass on a minified chunk (which under-counted Zod's presence due to build-specific mangling — do not trust string-grep signal strength on minified output as a substitute for real module attribution going forward).

---

## 3. Root Cause Chain

```
web/store/useInputStore.ts  (client-side Zustand store, imports `zod` directly)
  -> zod@4.4.3 (full library, 276.5KB in this chunk)
  -> bundled into /dashboard's client-side chunk (29aqk7js6-nfb.js / 1a1ao6646vx_f.js)
  -> chunk exceeds enforce-bundle.mjs's 250KB threshold (535.65KB, 2.1x over)
  -> contributes to /dashboard's FCP (3.34s, poor) / LCP (4.13s, needs improvement)
```

Zod is also imported broadly elsewhere in this codebase (18+ files: `lib/youtube.ts`, `lib/usage.ts`, `lib/validators/synthesis.ts`, most `app/api/**/route.ts` handlers, etc.) — most of those are server-only (API routes never ship to the client bundle), but `useInputStore.ts` is the confirmed client-side entry point pulling it into `/dashboard`.

---

## 4. Remediation Options (not yet decided or implemented)

1. **Move the `useInputStore.ts` validation server-side or to submit-time only**, removing the client-side Zod dependency from the store's synchronous import path. Lowest risk if the validation doesn't need to run on every keystroke/render.
2. **Adopt `zod/v4-mini`** (Zod v4's purpose-built lightweight bundle variant) for the client-side validation subset actually needed in `useInputStore.ts`, keeping full `zod` for server-only code paths.
3. **Code-split the store's validation logic** via dynamic import so Zod only loads when validation actually runs (e.g., on submit), not on initial `/dashboard` mount.
4. **Downgrade to Zod v3** for the client path specifically, if v3's smaller footprint is proven sufficient for this store's validation needs — lowest-effort but a version regression, weigh against v4-specific features already in use elsewhere.

No option has been implemented as of this ADR. This is a findings-and-decision document; the next step is a scoped decision + implementation task once a remediation path is chosen.

---

## 5. Why This Wasn't Caught Earlier

`enforce-bundle.mjs`'s 250KB warning has presumably been firing on this chunk for a while (its hash/size is stable across unrelated builds this session, e.g. before and after the icon-bundling fix), but a warning alone doesn't identify *why* a chunk is large — that gap is what this investigation closes. Route this class of finding through a real bundle analyzer at the point the warning first fires, not after a Speed Insights regression prompts a retroactive investigation.
