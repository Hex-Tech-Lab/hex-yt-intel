# OC TASK DIRECTIVE: WAVE 8 - RETRY RESILIENCE & OUTBOX IDEMPOTENCY

**Target Files:**
1. `web/components/dashboard/HighlightsScrubber.tsx`
2. `web/lib/chat/outbox.ts`

**Context & Requirements:**
### Task 1: HighlightsScrubber Error-State Retry Resilience
- **File:** `web/components/dashboard/HighlightsScrubber.tsx`
- **Problem:** When `error` is truthy (e.g. HTTP 403 or network failure), lines 313-316 execute:
  ```tsx
  if (error) {
    console.debug(`[HighlightsScrubber] collapsing: fetch error for ${analysisId}`);
    return null;
  }
  ```
  This unmounts the whole scrubber component and permanently hides the empty-state panel and the manual "Check Status" button, locking the user out of retrying.
- **Solution:** 
  Do NOT return `null` on `error`. Instead, let the component render the empty state card (lines 331-350), but with an error indicator and the functional "Check Status" button so the user can re-trigger `runFetchCycle(analysisId)`.
  Specifically:
  - If `error` is present and `!loading`:
    Render a Card with the message "Highlights temporarily unavailable (click Check Status to retry)" or an inline error note, and keep the `<button onClick={() => runFetchCycle(analysisId)}>` visible and active.
  - Reset `error` or allow `runFetchCycle` to clear error on a fresh retry attempt.

### Task 2: Outbox Idempotency Edge-Case Guard
- **File:** `web/lib/chat/outbox.ts`
- **Problem:** When both `crypto.randomUUID` and `crypto.getRandomValues` throw/fail, line 77:
  ```ts
  return `${Date.now()}-${Date.now().toString(36)}`;
  ```
  collides if multiple messages are created in the same millisecond, breaking server-side deduplication.
- **Solution:**
  Add a module-level monotonic sequence counter:
  ```ts
  let fallbackCounter = 0;
  ```
  In the crypto-failure catch block, return:
  ```ts
  fallbackCounter = (fallbackCounter + 1) & 0xffff;
  return `${Date.now()}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  ```

**Strict Instructions for OC:**
- Make ONLY these surgical edits.
- Ensure TypeScript compilation passes without errors.
- Output ONLY unified diffs.
