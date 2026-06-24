### First break point

- **stage**: readback — GET /api/analyses/[id]
- **why it breaks**: Line 35 returns `analysis_markdown || ''`. When `analysis_markdown` is NULL (chunk-stitched analyses that hit timeout/abort before markdown migration), the response returns empty string. The UI (SelectedDimensionReadout) receives empty markdown and shows its new placeholder "Select a dimension to view details" permanently — the user sees no content even though `analysis_payload` contains complete dimension data.
- **evidence**: `web/app/api/analyses/[id]/route.ts:35` — `analysis_markdown: analysis.analysis_markdown || ''`

### Fix applied

- **file**: `web/app/api/analyses/[id]/route.ts`
- **before**: line 35 returned `analysis_markdown || ''` with no payload-based fallback
- **after**: line 36 now falls back to `reconstructMarkdown(analysis.analysis_payload)` when `analysis_markdown` is null/empty and `analysis_payload` exists
- **evidence**:
```
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
...
analysis_markdown: analysis.analysis_markdown || (analysis.analysis_payload ? reconstructMarkdown(analysis.analysis_payload as any) : ''),
```
- **label**: code-observed

### Verification

- **what is now proven**: `reconstructMarkdown` imports only a type (`UCISPayloadV2`), no runtime dependencies — edge-runtime compatible (code-observed). Type-check passes with 0 errors (runtime-proven via `pnpm --filter @hex-yt-intel/web type-check`).
- **what remains unknown**: whether chunk-stitched analyses with NULL `analysis_markdown` actually exist in production — the fix is defensive and only activates when they do.
- **what downstream behavior is still dependent on this fix**: the SelectedDimensionReadout and DimensionAccordion both depend on `analysis_markdown` being populated in the API response. If `reconstructMarkdown` produces valid markdown that matches the original structure, the UI renders correctly. If `analysis_payload` is also NULL or malformed, the empty-string fallback at the end of the ternary still applies.

### Risks / follow-ups

- `reconstructMarkdown` is a pure string-builder — it depends on the payload shape matching `UCISPayloadV2`. If chunk-only payloads (with only `dimensions` array, no `persona`) hit this fallback, the reconstructed markdown will be missing the persona header. The chunk stitch at the persist route always includes persona (default fallback at route.ts:249-250), so this risk is minimal in practice.
- The `as any` cast at line 36 avoids a type mismatch between the Supabase query result type and `UCISPayloadV2` — safe because `reconstructMarkdown` uses passthrough access.

### Conclusion

The readback route now falls back to `reconstructMarkdown(analysis.analysis_payload)` when `analysis_markdown` is NULL. A chunk-stitched analysis with `analysis_payload` present but NULL `analysis_markdown` will now return reconstructed markdown instead of empty string, allowing the UI to render dimension content instead of the "Select a dimension" placeholder permanently.