# Mission: Wave 4 - Task 2: Highlights Recovery Polling & Manual Refresh

Time limit is strict; do not read unrelated files.

**Objective 1: Polling Schedule (The 'Sabrina Ramonov' bug)**
Modify `web/lib/utils/highlights-settings.ts`:
- Update `HIGHLIGHTS_STATUS_RETRY_MAX_ATTEMPTS = 8;`
- Define `HIGHLIGHTS_POLL_INTERVALS = [0, 3000, 6000, 10000, 15000, 25000, 35000, 45000] as const;` (or update `getHighlightsRetryDelayMs(attempt: number)` so the 8-attempt schedule spans at least 45 seconds total).
- Ensure `web/lib/hooks/useHighlightsStatus.ts` and `web/components/dashboard/HighlightsScrubber.tsx` continue using these shared settings.

**Objective 2: Manual Refresh Button**
Modify `web/components/dashboard/HighlightsScrubber.tsx`:
- When empty (all polls exhausted, `!data || data.highlights.length === 0`), the UI says "No highlights yet / Use Re-analyze...".
- Add a discrete, secondary-styled "Check Status" or "Refresh" button next to/below that message.
- The button must call `runFetchCycle(analysisId)` to manually trigger a fresh pull without triggering a full re-analysis.
- Ensure a spinning loader/disabled state while fetching.
- Update `web/components/dashboard/__tests__/HighlightsScrubber.test.tsx` to align with the 8-attempt schedule.

Provide the unified diffs. No explanations.
