# Mission: Wave 4 - Task 3: INP 248.6ms Optimization (Dimension Accordion / Dashboard)

Time limit is strict; do not read unrelated files.

**Flaw:**
Clicking `span.text-xs.text-[var(--ink-secondary)]` (the dimension trigger in `DimensionAccordion`) triggers a 174ms full-tree DOM thrash across 11 dimension cards, creating an INP spike to 248.6ms.
Root causes:
1. `handleSelect` in `web/components/templates/console/DimensionAccordion.tsx` recreates on every `selectedDimensionKey` change, busting `DimensionItem` memoization and re-rendering all 11 items.
2. In `DashboardContainer.tsx`, `setSelectedDimensionKey={(k) => startTransition(() => setSelectedDimensionKey(k))}` is passed as an inline anonymous function on every render.
3. `DimensionAccordion` (dashboard wrapper), `HighlightsScrubber`, and `ExecutiveSummary` are unmemoized or re-rendering on parent updates.

**Architectural Directives & Constraints (From Lead Architect):**
- **CRITICAL ANTI-PATTERN:** Do NOT use deep-equality checks (`lodash.isEqual` or JSON stringify) inside `React.memo` for dimension payloads. It will freeze the main thread. Use primitive prop checks (e.g., identity, status, key, or reference equality).
- Wrap dimension selection state transitions in `startTransition`.

**Exact Modifications Required:**

1. **`web/components/containers/DashboardContainer.tsx`:**
   - Define a stable `handleSelectDimension` with `useCallback` and `startTransition`:
     ```tsx
     const handleSelectDimension = useCallback((key: string | null) => {
       startTransition(() => {
         setSelectedDimensionKey(key);
       });
     }, []);
     ```
   - Pass `setSelectedDimensionKey={handleSelectDimension}` to `ProDashboardView` (or wherever `selectedDimensionKey` setter is passed down).

2. **`web/components/templates/console/DimensionAccordion.tsx`:**
   - Make `handleSelect` reference-stable by storing `selectedDimensionKey` in a ref (`useRef(selectedDimensionKey)`):
     ```tsx
     const selectedKeyRef = useRef(selectedDimensionKey);
     selectedKeyRef.current = selectedDimensionKey;

     const handleSelect = useCallback((key: string) => {
       onSelectDimension(selectedKeyRef.current === key ? null : key);
     }, [onSelectDimension]);
     ```
   - In `DimensionItem = memo(...)`:
     Provide a custom comparator checking only primitive/reference props:
     ```tsx
     (prev, next) => (
       prev.isSelected === next.isSelected &&
       prev.index === next.index &&
       prev.d.key === next.d.key &&
       prev.d.label === next.d.label &&
       prev.d.icon === next.d.icon &&
       prev.d.status === next.d.status &&
       prev.d.content === next.d.content &&
       prev.onSelect === next.onSelect
     )
     ```

3. **`web/components/dashboard/DimensionAccordion.tsx`:**
   - Wrap `DimensionAccordion` export with `memo`:
     ```tsx
     export const DimensionAccordion = memo(function DimensionAccordion(...) { ... });
     ```
   - Compare primitive props: `status`, `selectedDimensionKey`, `dimensions` (reference), `onSelectDimension` (reference).

4. **`web/components/dashboard/HighlightsScrubber.tsx`:**
   - Wrap `HighlightsScrubber` export with `memo`:
     ```tsx
     export const HighlightsScrubber = memo(function HighlightsScrubber(...) { ... });
     ```
   - Compare primitive props: `prev.analysisId === next.analysisId && prev.videoDurationSeconds === next.videoDurationSeconds && prev.digestLoading === next.digestLoading`.

5. **`web/components/organisms/ExecutiveSummary.tsx`:**
   - Wrap `ExecutiveSummary` export with `memo`:
     ```tsx
     export const ExecutiveSummary = memo(function ExecutiveSummary(...) { ... });
     ```
   - Compare primitive/reference props: `prev.loading === next.loading && prev.data === next.data`.

Provide the unified diffs. No explanations.
