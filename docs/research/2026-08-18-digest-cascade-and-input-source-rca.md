# Digest Cascade & Input Source RCA — 2026-08-18

## Q1: Does the digest have its own cascade?

**Before this fix: no.** Both `web/app/api/analyses/digest/route.ts` and
`web/app/api/webhooks/digest/route.ts` called `resolveChatCascade()` —
sharing `cascade.chat` (Cerebras-primary, tuned for chat's speed-first
tradeoff) with zero dedicated key. No `cascade.digest` existed in any
Settings Registry migration or in `cascade.ts`'s `resolve*Cascade()` set —
confirmed by reading all 4 `*cascade*` migrations and the full contents of
`web/lib/config/cascade.ts` before making any change. This contradicted the
standing "each helper function gets its own cascade" directive already
applied to `cascade.stance` and `cascade.entityExtraction` (both split out
of `cascade.analysis`/`cascade.chat` for the same reason: independent
OpenRouter cost-log attribution and independent tuning).

**Fix applied:**
- New migration `supabase/migrations/20260817232804_cascade_digest.sql`
  (applied via Supabase Management API, then renamed from an invented
  timestamp to the real server-assigned version per ADR 018 —
  `list_migrations` confirms `20260817232804 cascade_digest`). Seeds
  `cascade.digest`: same 3-tier gpt-oss-120b/groq-cerebras-baseten shape as
  `cascade.chat`, but **Groq-primary / Cerebras-fallback** (reordered, not
  a model change) per explicit user directive 2026-08-17 — digest runs in
  the background, so chat's Cerebras-first speed premium doesn't apply;
  Groq is cheaper and still fast.
- `web/lib/config/cascade.ts`: added `DIGEST_CASCADE_FALLBACK`,
  `resolveDigestCascade()`, and a `digest` entry in `CASCADE_FALLBACKS`.
- Both digest routes now import and call `resolveDigestCascade()` instead
  of `resolveChatCascade()`.
- Live registry row verified post-migration via direct SQL query — real
  content matches migration exactly, Groq listed first.

## Q2: What does the digest actually use as input?

**Confirmed: the full 11-dimension UCIS synthesis markdown, not raw
transcript.**

- `GenerateExecutiveDigestUseCase.execute()` selects
  `analysis_markdown, analysis_payload, executive_digest, video_id` and
  calls `reconstructDigestMarkdown(row.analysis_markdown, row.analysis_payload)`.
- That function prefers `analysis_markdown` verbatim; if empty, it calls
  `reconstructMarkdown()` (`web/lib/utils/markdown-reconstructor.ts`) on
  `analysis_payload` (typed `UCISPayloadV2`), which iterates
  `payload.dimensions[]` (`number`/`name`/`content`) and emits
  `### DIMENSION N – NAME` blocks plus persona/classification/monetization
  sections — genuinely the full synthesis output, not transcript text.
  `analysis_markdown` itself is written by `update_analysis_result_atomic`
  from the same synthesis pipeline (`SupabaseAnalysisAdapter.ts`), never
  from a transcript field.
- **Empirical confirmation**: pulled 3 real `dimension_count=11` rows via
  Supabase Management API SQL query. All three show real synthesis
  structure — `=== PERSONA CONFIGURATION ===`, `### DIMENSION 1 – APEX
  INTELLIGENCE`, `**EXECUTIVE_SUMMARY**` — not transcript-shaped content.
  No credential values were printed at any point.
- No transcript field (`transcripts`/`transcript_markers`) is read
  anywhere in the digest execute path — only the highlights-extraction
  side-effect (`extractHighlights`) reads transcript segments, and that is
  a separate, best-effort, non-digest pass.

## Files changed

- `supabase/migrations/20260817232804_cascade_digest.sql` (new)
- `web/lib/config/cascade.ts`
- `web/app/api/analyses/digest/route.ts`
- `web/app/api/webhooks/digest/route.ts`

## Gates run

- `pnpm --filter @hex-yt-intel/web exec tsc --noEmit` — clean.
- `pnpm exec vitest run` (web workspace) — 91 files / 1180 tests passed,
  16 skipped, 0 failures.
