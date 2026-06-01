# Dashboard State Validation Protocol

**Date**: 2026-06-01  
**Scope**: Verify BentoGrid mounts correctly after successful analysis  
**Status**: Ready for manual testing

---

## Test Scenario: Trigger State Transition

### Prerequisites
- Production URL: https://hex-yt-intel.vercel.app (or local `pnpm dev`)
- Valid YouTube URL with subtitles (e.g., a YouTube Learn video)
- Browser DevTools open (F12)

### Test Flow

#### Step 1: Initial State Inspection
1. Navigate to `/dashboard`
2. Verify **View 1 (Input Panel)** is visible:
   - URL input field present
   - "Fetch Metadata" button visible
   - "Create Synthesis" button visible
   - Synthesis output area on left (empty or previous result)
3. Check Network tab: No recent `/api/analyses` POST calls

**Expected**: View 1 only, `analysisData === null` in component state

---

#### Step 2: Trigger Analysis
1. Paste valid YouTube URL into input field
2. Click **"Create Synthesis"** button
3. Open **Network tab** and filter for `/api/analyses` POST
4. Monitor the SSE stream:
   - Should see `data: {...}` chunks arriving
   - Console should show parsed tokens being accumulated
5. Wait for stream to complete (`[DONE]` marker)

**Expected**: Synthesis markdown streams to left panel in View 1

---

#### Step 3: State Transition (Critical Gate)
1. After stream completes and toast says "Analysis complete!":
   - **View 1 should disappear**
   - **View 2 (BentoGrid) should mount**
2. Verify BentoGrid structure:
   - Title: "YouTube Content Analysis"
   - "Core Identity" section with 3 cards (Content Type, Primary Topic, Secondary Topic)
   - "Risk Profile" section always visible
   - If transcript available: "Persuasion & Claims", "Tone & Emotion", "Structure & Hooks" sections
3. Check Network tab for new assets:
   - Should see CSS chunks for BentoGrid
   - Should see component JS bundles load
4. Inspect `x-model-meta` header in `/api/analyses` response:
   ```
   x-model-meta: free-tier-waterfall (indicates 3-tier waterfall active)
   ```

**Expected**: BentoGrid fully rendered, View 1 hidden

---

#### Step 4: AmbientCanvas Verification
1. Look behind BentoGrid:
   - Should see animated particle background
   - Blue accent dots moving and connecting
   - No jarring visual conflicts
2. Inspect element on canvas:
   - Should be positioned `absolute inset-0 pointer-events-none`
   - Z-index: 0 (background)
3. Content overlay z-index: 10 (in front)
4. Disable motion and refresh:
   - Set OS accessibility: `prefers-reduced-motion: reduce`
   - Refresh page
   - AmbientCanvas should render static (no animation)

**Expected**: Smooth particle animation, no layout shift, proper z-ordering

---

#### Step 5: Metadata-Only State (Optional)
If transcript is unavailable:
1. `validation_report.analysis_type` should be `'metadata-only'`
2. Amber warning banner should appear:
   ```
   ⚠️ Transcript unavailable - analysis based on metadata only
   ```
3. Tiers 2-4 (Persuasion, Tone, Structure) should be hidden
4. Tier 1 (Identity) and Tier 5 (Risk) still visible
5. Risk card should show: "⚠️ Limited analysis"

**Expected**: Graceful degradation, clear user messaging

---

## Cache Hit Scenario (Post-MVP)

After Upstash caching is wired:

1. Run analysis on Video A (completion time: ~15 seconds)
2. Clear `analysisData` state (refresh page)
3. Run same analysis again
4. Check response headers:
   ```
   x-cache: HIT (if Upstash returns cached result)
   ```
5. Completion time should be <100ms (cached path)

**Expected**: Sub-50ms cache hits for repeat analyses

---

## Troubleshooting Matrix

| Symptom | Root Cause | Fix |
|---------|-----------|-----|
| View 1 persists after "Analysis complete!" | `analysisData` not being set | Check console for parsing errors in `handleAnalyze` |
| BentoGrid appears but is blank | `analysis` prop is null | Verify `setAnalysisData()` was called with structured data |
| Layout shift visible | Z-index conflict or missing `relative` container | Inspect element z-order stack |
| Canvas not animating | SSR hydration mismatch or `ssr: false` not honored | Hard refresh + clear cache |
| "Analyze" button disabled after run | `loading` state not resetting | Check `finally` block in error handling |
| Old synthesis text visible behind grid | CSS `opacity` or `display` issue | Check `styles.panelContainer` visibility |

---

## P0 Regression Criteria

Escalate to P0 if:
- [ ] BentoGrid does not mount after successful analysis completion
- [ ] Canvas renders but causes main-thread blocking (FCP >3s)
- [ ] Layout shift >0.1 CLS during state transition
- [ ] Any TypeScript console errors (not warnings)
- [ ] Network waterfall shows >5 additional HTTP requests

---

## Sign-Off Checklist

- [ ] View 1 (Input) renders on page load
- [ ] Analysis triggers without errors
- [ ] SSE stream completes with `[DONE]` marker
- [ ] View transitions to BentoGrid after completion
- [ ] All 5 tiers visible (assuming transcript available)
- [ ] AmbientCanvas animates smoothly behind content
- [ ] Z-index layering prevents visual conflicts
- [ ] Hard refresh preserves BentoGrid state
- [ ] Export PDF button functional
- [ ] Share link button functional

---

**Next Step**: Run a live analysis and report the outcome of Step 3 (State Transition). If BentoGrid mounts successfully, the integration is validated. If not, capture console errors and network waterfall for root-cause analysis.

