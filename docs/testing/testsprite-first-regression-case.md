# TestSprite first regression case: Highlights Reel missing after tab refresh

**Status**: drafted 2026-09-07, to be run as soon as TestSprite MCP is active in this session.

## Login
Use the test-auth bypass, not Google OAuth (Google's bot detection blocks automated browsers — this is the documented reason `/api/test-auth/login` and the sign-in form's test-auth fields exist):
- URL: `https://www.getvintel.com/auth/signin`
- Email: `testsprite@getvintel.com`
- Password: see `TESTSPRITE_TEST_ACCOUNT_PASSWORD` in `.env.local` (reset 2026-09-07, not yet live-verified)
- The test-auth form fields only render if `testAuthBypass.enabled` is true in the Settings Registry — confirmed true as of 2026-09-07.

## Reported symptom (user, 2026-09-07)
> "there is regression. the highlight reel control is not showing after tab refresh."

Video under test: `MTZwSjiDg30` (analysis id `e8bcb2cc-4cc1-4189-b932-b04ec881d181`), already fully analyzed with 10 highlights confirmed present in `analysis_highlights` (verified directly against the DB same session).

## Steps
1. Sign in via the test-auth bypass above.
2. Navigate to `https://www.getvintel.com/dashboard`.
3. Load the existing analysis for video `MTZwSjiDg30` (either paste `https://www.youtube.com/watch?v=MTZwSjiDg30` into the analyze box and let AutoRestore pick up the existing analysis, or use Analysis History to reopen it).
4. **Confirm the Highlights Reel control is visible** (the horizontal marker-track scrubber under the video player, with a "Play highlights" button) — this is the expected/working state before refresh.
5. **Hard-refresh the tab** (not a client-side navigation — an actual full page reload, matching the user's report).
6. Wait for the page to finish loading (AutoRestore should log `[AutoRestore] Existing analysis detected for video, fetching details: e8bcb2cc-...` in the console — confirmed this fires correctly).
7. **Check whether the Highlights Reel control is visible now.** Per the report, it should be MISSING at this point (the regression).

## What to capture if it reproduces
- Full console log from page load through step 7.
- Full network request list — specifically, confirm whether `GET /api/analyses/highlights?analysisId=e8bcb2cc-4cc1-4189-b932-b04ec881d181` fires at all after the refresh. (On the user's own pasted network log from the same bug, this request was ABSENT post-refresh, present pre-refresh — strong signal the component never mounts or its fetch-gate condition is never satisfied, not that the request itself failed.)
- The value of `effectiveViewMode` at the time (Simple vs Pro) — `HighlightsScrubber` only renders inside `SimpleDashboardView`, gated on `status === "complete" && analysisId` (see `web/components/containers/SimpleDashboardView.tsx:47`). If a refresh-time race puts the user in Pro mode when they were in Simple before refresh (or vice versa), that alone would explain the disappearance without any bug in `HighlightsScrubber` itself.
- Whether this correlates with the `useEntitlements`/`useEffectiveViewMode` bug fixed in PR #292 (not yet merged) — that bug made a Pro/Simple toggle appear stuck after a Supabase token refresh, which could plausibly also affect which dashboard variant renders after a full page reload (a reload re-runs the same auth bootstrap path). If reproducing this ONLY happens on accounts where PR #292's bug applies, and disappears once #292 merges, that would confirm the same root cause.

## Hypothesis ranking (not yet confirmed, for whoever investigates next)
1. **Most likely**: `effectiveViewMode` resolves to `"pro"` post-refresh when the user was actually viewing Simple mode before (or the reverse hides it) — same entitlements-timing family as PR #292, possibly not fully fixed by that PR alone since a full-page reload is a fresh bootstrap, not just an auth-event.
2. **Possible**: `status`/`analysisId` in `useAnalysisStore`/`useSynthesisNucleus` briefly resolve to a non-"complete" state or `null` at the exact render pass `SimpleDashboardView` checks its gate, and never re-renders once they do settle (a missed-dependency or stale-closure bug in `useAutoRestoreAnalysis`).
3. **Less likely**: a real bug inside `HighlightsScrubber`'s own fetch effect — ruled mostly out by the network log showing the request never even fires, which points upstream of the component's own logic to whether it mounts at all.

## Verification criteria
- FAIL (regression confirmed): Highlights Reel control absent after hard refresh, present before.
- PASS: Highlights Reel control present in both states.
- If it fails, capture the console+network evidence above and hand it back for root-causing — do not attempt a speculative fix without that evidence, per this project's own "verify before fixing" standing practice.
