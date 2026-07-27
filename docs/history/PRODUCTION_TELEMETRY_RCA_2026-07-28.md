# Production Telemetry RCA & Resolution Report

**Date**: 2026-07-28  
**Author**: AGY (Gemini Lead Agent)  
**Location**: `/docs/history/PRODUCTION_TELEMETRY_RCA_2026-07-28.md`  
**Target Audience**: Lead Orchestrator & Development Team  

---

## 1. Issue Overview & Empirical RCA

Analyzing the production logs provided from Vercel and Chrome browser console yielded three distinct root causes:

### Issue A: Video Player Turning Black / Ready Timeout Failure
- **Symptom**: *"It seems to be working but the video dies out and turns black after a few secs and the retry bar appears below"* + Browser console log `[VideoPlayerCard] Player ready timeout - API may have failed to initialize`.
- **Root Cause**:
  In `web/components/templates/console/VideoPlayerCard.tsx`, line 54 initialized a 30-second fallback timer (`readyTimeout`). However, when `onReady()` fired successfully, `clearTimeout(readyTimeout)` was **NEVER called** inside `onReady()`.
  As a result, 30 seconds after player mounting, `readyTimeout` triggered, invoked `adapter.destroy()`, set `playerRef.current = null`, and destroyed the active player!
- **Fix**: Added `clearTimeout(readyTimeout)` directly inside the `onReady()` callback.

---

### Issue B: Stance Relations Engine Zod Schema Validation Failure
- **Symptom**: Vercel log line `[relations/engine] Model openai/gpt-oss-120b JSON schema validation failed: source: Invalid input: expected number, received NaN`.
- **Root Cause**:
  When `openai/gpt-oss-120b` emitted JSON, it returned string-formatted dimension numbers (e.g., `"D1"`, `"Dimension 4"`). Zod's `z.coerce.number()` failed to parse `"D1"` into an integer, yielding `NaN` and failing schema validation.
- **Fix**: Added `sanitizeDimensionNumber` pre-processor using `z.preprocess()` to strip non-digit characters before coercion (`"D1"` -> `1`).

---

### Issue C: Non-Blocking Question Capture Storage Warning
- **Symptom**: Vercel log line `[question-capture] Async storage failed (non-blocking): Failed to store question in Supabase Storage: Bucket not found`.
- **Root Cause**:
  `web/app/api/chat/capture-question/route.ts` attempted to write question capture files to Supabase Storage bucket `'analyses'`. In environments where the bucket hasn't been provisioned, Supabase returned `Bucket not found`.
- **Fix**: Added `isMissingBucket` handling to log a clean warning without throwing non-blocking console errors.

---

## 2. Verification

- `pnpm --filter @hex-yt-intel/web type-check`: **PASSED (0 errors)**.
- `vitest`: **PASSED (46/46 test files, 860 unit tests green)**.
- Git Commit [`ba033166`](https://github.com/Hex-Tech-Lab/hex-yt-intel/commit/ba033166) pushed to `main`.
