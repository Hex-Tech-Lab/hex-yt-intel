# Agent Dispatch Prompt — Wave 4 Remediation

**Target Agent**: OpenCode (OC)
**Model Preset**: `@preset/glm-53-flash-on-cheap` (`glm-5.3-flash`, low effort)
**Provider Order**: `baseten`, `morph`, `together` (Strict order, `allow_fallbacks: false`)

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the canonical, authoritative version.**
> Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with intent + target files as your first action; re-check the ledger after every subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what actually happened as your last action; use the `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.

---

## 1. Context & Objectives

The user reported three distinct bugs observed on mobile and web:
1. Highlights empty state permastuck: Sabrina Romanov video (`EOiypb2wXM0`) had 12 completed highlights stored in the database, but client reported "No highlights yet. Use Re-analyze to generate this video's keypoint reel." Polling loop gave up prematurely.
2. Sentry Issue `HEX-YT-INTEL-5V`: `TypeError: Cannot read properties of null (reading 'getItem')` on `https://www.getvintel.com/dashboard` in Android WebViews / incognito because `window.localStorage` is `null`.
3. High INP (248.6ms): clicking `span.text-xs.text-[var(--ink-secondary)]` in `DashboardContainer.tsx` / `HighlightsScrubber.tsx` / `DimensionAccordion.tsx` triggers a 174ms unmemoized tree thrash across 11 dimension cards.

---

## 2. Surgical Workstreams (Step-by-Step)

### Workstream 1: Highlights Recovery & Decaying Long-Poll (`HighlightsScrubber.tsx`)
- **Root Cause**: Polling terminates after 5 rapid attempts (0s, 2.5s, 5s, 10s, 15s). Generation often takes 16–22s, leaving the user permanently in the empty state.
- **Actions**:
  1. In `web/components/dashboard/HighlightsScrubber.tsx`, extend the poll schedule with a decaying backoff out to 45 seconds (e.g. 0s, 2s, 4s, 8s, 12s, 20s, 30s, 45s).
  2. On the empty state card ("No highlights yet"), add an explicit "Check Status / Refresh" button that re-triggers the status query (`fetchHighlights(true)`) directly without triggering a full re-analysis.
  3. Ensure that when highlights arrive, the component seamlessly updates and transitions from empty/loading to the highlights timeline.

### Workstream 2: Sentry HEX-YT-INTEL-5V (`safe-storage.ts` & Storage Wrappers)
- **Root Cause**: In restricted environments (Android WebViews, Chrome incognito with third-party cookie restrictions), `window.localStorage` is `null` or throws security errors. Calling `.getItem()` on `null` crashes the application.
- **Actions**:
  1. Create `web/lib/utils/safe-storage.ts`.
  2. Implement `getSafeLocalStorage(): Storage` and `getSafeSessionStorage(): Storage` with an in-memory dictionary fallback that implements the standard `Storage` interface (`getItem`, `setItem`, `removeItem`, `clear`, `length`, `key`).
  3. Update `web/store/useInputStore.ts` where `createJSONStorage(() => (typeof window !== 'undefined' ? localStorage : ...))` passes `null`. Use `getSafeLocalStorage()`.
  4. Replace bare `localStorage` access in `web/components/dashboard/ChatDock.tsx`, `web/lib/utils/outbox.ts`, and `web/store/useChatStore.ts` with safe storage helpers.

### Workstream 3: INP 248.6ms Optimization (`DashboardContainer.tsx` & Accordions)
- **Root Cause**: Clicking nav buttons or accordions triggers synchronous blocking re-renders across all 11 dimension readouts.
- **Actions**:
  1. In `web/components/containers/DashboardContainer.tsx`, wrap `setActiveNav` and dimension focus updates inside `React.startTransition`.
  2. Apply `React.memo` to `HighlightsScrubber`, `DimensionAccordion`, and `ExecutiveSummary` with appropriate shallow/prop equality comparators to prevent unnecessary re-renders when other container tabs change.

---

## 3. Verification Gates
1. Run `pnpm --filter @hex-yt-intel/web type-check` (must pass with 0 errors).
2. Run vitest suites: `pnpm --filter @hex-yt-intel/web exec vitest run`.
3. Add unit test in `web/lib/utils/__tests__/safe-storage.test.ts` verifying null/restricted storage fallback.
