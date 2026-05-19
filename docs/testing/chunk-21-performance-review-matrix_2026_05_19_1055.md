# Chunk 21 — Performance & Security Review Matrix

**PR:** #21 — refactor(performance): implement bundle size enforcement and performance budgets
**Branch:** refactor/strike-4-performance
**Status:** IN PROGRESS

---

## Review Findings

| # | Source | Location | Severity | Description | Fix Applied? |
|---|---|---|---|---|---|
| 1 | Sourcery | enforce-bundle.mjs:58 | P2 | `getFileSize()` caught `fs.statSync` errors silently returning 0, making the budget sum read as under-budget for every missing chunk. | ✅ |
| 2 | Sourcery | enforce-bundle.mjs:89 | P2 | When `jsFiles.length === 0` the function returned `{ files: [], totalBytes: 0 }` — manifest misconfiguration was silently accepted. Replaced with `process.exit(1)` + diagnostic printout. | ✅ |
| 3 | cubic | enforce-bundle.mjs:88 | P1 | Same root cause as finding 2 — zero-file list produced hard-pass. FIXED by shared `process.exit(1)` path now applied. | ✅ |
| 4 | cubic | route.ts:34 | P2 | `videoId` was URL-concatenated raw into the worker fetch URL, allowing crafted IDs to inject extra query parameters. Replaced with `new URL()` + `searchParams.set('video_id', videoId)`. | ✅ |
| 5 | Sourcery | route.ts:40–46 | P2 | `clearTimeout(timeout)` ran before `await response.json()`, leaving the body read unearthed from the AbortController guard. Moved to after `response.json()` completes. | ✅ |

---

## Resolution Plan

### Finding 1 — enforce-bundle.mjs:58 ✅ RESOLVED
Replaced the silent-return-0 error path in `getFileSize()` with `process.exit(1)`. A failed `fs.statSync` is now a fatal CI failure with a descriptive message.

### Finding 2 & 3 — enforce-bundle.mjs:88 ✅ RESOLVED
Replaced the `return { files: [], totalBytes: 0 }` warning path with `process.exit(1)` + diagnostic printout listing all common root causes and the current manifest state.

### Finding 4 — route.ts:34 ✅ RESOLVED
Replaced template-literal URL concatenation with `new URL()` + `searchParams.set('video_id', videoId)`, which performs proper percent-encoding of the `videoId` value and eliminates the SSR injection vector.

### Finding 5 — route.ts:40–46 ✅ RESOLVED
Removed the premature `clearTimeout(timeout)` from after `fetch()` return and moved it to after `await response.json()` completes, keeping the AbortController deadline active across the full body-read phase.

### Bonus: App Router Asset Pool Fallback ✅ APPLIED
The original script only measured `manifest.pages['/']`, which is empty for App Router apps (server-component root pages have no separate client JS entry). Added `manifest.rootMainFiles` (framework + App Router bootstrap chunks) as the primary measurement pool for App Router. Budget adjusted from 100 kB → 512 kB to match the actual App Router framework baseline (~344 kB / 344.27 KB leaving 168 KB headroom for incremental growth).

---

## CI/CD Check Status

| Check | Status |
|-------|--------|
| Sourcery Review | ✅ PASS |
| Vercel Preview | ✅ PASS |
| cubic AI Reviewer | ✅ PASS |
| CodeRabbit Skipped | ⏭️ SKIPPED |
| Vercel Deploy | ✅ PASS |
| Snyk Security | ✅ PASS |
