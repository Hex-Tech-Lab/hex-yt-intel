# V5 Fix Prompt — execute in order (agents: do not push until P0/P1 complete)
Repo: hex-yt-intel. Context: V5 transcript-72h build review (see council-transcript-2026-07-18-v5-review.md). All findings source-verified. Follow AGENT_LEDGER protocol.

## P0 — Security & data integrity (block everything else)

### P0.1 Rotate leaked API keys
- SerpAPI, Exa, and Decodo FastSearch credentials are hardcoded at `scripts/research/run-transcript-research.ts:4-6` and were pasted into chat logs. Treat as burned.
- Rotate all three at provider dashboards. Then edit the file: remove the string fallbacks — `process.env.SERPAPI_API_KEY` etc. must throw if unset. Grep `docs/research/` and the whole tree for the old key prefixes (`b642`, `bb950b`, `VTAwMDA0Nj`) and scrub any hits before any commit. Verify none of these files are staged.

### P0.2 Cache-poison guard in persist route
- File: `web/app/api/analyses/persist/route.ts`. Line ~621: `const isStitchedValid = stitchResult.payload !== undefined;` — since `stitchChunksIntoPayload` now ALWAYS returns a payload (partial fallback added at ~line 213-232), this is always true, so schema-invalid partials are persisted as `done`/`valid:true` and cached under Law #1 forever.
- Fix: make `stitchChunksIntoPayload` return an explicit `validationPassed: boolean` (false on the partial path) alongside payload/markdown. In the caller: keep writing the partial markdown (that part of V5 is good) but set `validationPassed=false`, status `partial` (not `done`), and DO NOT write the analysis cache (`setAnalysisCache`) for partial results — a re-run must remain possible. Also confirm the ADR008 chat gate accepts `partial` markdown (grounding) or explicitly decide it shouldn't.
- Also remove the `as any` casts by typing the partial payload properly or narrowing.

## P1 — Migration corrections (before `supabase db push` / apply_migration)
File: `supabase/migrations/20260718000000_add_transcripts_and_markers.sql` (not yet applied — edit in place).
1. Drop the FK `transcript_markers.video_id REFERENCES transcripts ON DELETE CASCADE` — markers must SURVIVE the 72h transcript purge (that's the whole design intent). Keep `video_id text not null` + existing indexes.
2. Delete both no-op RLS policies (`using(false) with check(false)`) and the confused comment. Keep `enable row level security` with a one-line comment: "no policies on purpose — service_role bypasses RLS; anon/authenticated fully blocked."
3. Fix `compliance_check_transcripts()` to key on `expires_at < now()` (same clock as purge), not `created_at` — upsert resets created_at which silently restarts apparent retention.
4. Delete `calculate_marker_budget()` from the migration (duplicated in TS, uncalibrated — single source of truth in TS if/when markers ship).

## P2 — Correctness bugs in shipped TS
1. `web/lib/adapters/SupabaseTranscriptAdapter.ts` `deduplicateMarkers`: clustering compares each marker to the cluster's LAST element → unbounded chaining (scene cuts every 4s collapse to 1 marker). Compare against the cluster's FIRST (anchor) start instead. Add a unit test with 30 markers spaced 4s apart expecting ~multiple survivors.
2. `saveMarkers`: upsert on (video_id,idx) never deletes stale tail rows → guaranteed ghost markers on any shrinking re-run (e.g., 80→55 leaves 25 ghosts). Fix: within a single call, `delete from transcript_markers where video_id = $1` then insert, or delete `idx >= newCount` after upsert.
3. `web/app/api/webhooks/ffmpeg-enrich/route.ts`: `existingMarkers: z.array(z.any())` — replace with a strict marker schema; force `video_id` to the payload's videoId; default/clamp `importance` to [0,1].
4. `web/lib/prompts/executive-digest.ts`:
   - Reduce `truncateForDigest` cap from 30_000 to 18_000 chars (30k Arabic chars ≈ 15–20k tokens → still overflows 8k/16k fallback models; 18k is safe for a 16k floor with 2.5k reserved). Alternatively gate the digest cascade to ≥32k-context models and keep 30k.
   - Arabic header regexes use `\b`, which is ASCII-only in JS and never matches Arabic — dead code. Replace `\b(ملخص...)\b` alternatives with lookaround-free patterns anchored to line starts: e.g. `(?:^|\n)\s*(?:####\s*0\.1\b[^\n]*|(?:snapshot|ملخص\s*سريع|لمحة)\s*[::])` — require line-start + trailing colon so English words like "snapshot" mid-sentence don't split sections.
   - The no-headers fallback fabricates a digest from ANY ≥20-char text, including model refusals. Add guards: reject if text matches common refusal patterns or has <3 non-empty lines; NEVER let a fallback-parsed digest be persisted as final — tag it (e.g., `parsedVia:'fallback'`) and let caller decide.
5. `web/lib/utils/format.tsx` `linkifyTimestamps`:
   - Reject seconds ≥60 (`16:90` currently links) and minutes ≥60 in mm:ss when part of hh:mm:ss.
   - Don't linkify inside inline code spans (backticks), inside existing markdown links `[...](...)`, or immediately after a date fragment (negative lookbehind for `\d{4}-\d{2}-\d{2}[T ]?` and for `\d-`).
   - The per-line skip `line.includes('](#t=')` suppresses ALL other timestamps on that line — replace with per-match check only (that check already exists; delete the line-level skip).

## P3 — Wire the actually-valuable path (makes the AR-film proof real)
1. Player seek (hours, high value): `web/components/dashboard/SelectedDimensionReadout.tsx:64` and `web/components/templates/console/ChatDock.tsx:408` render markdown `a` as plain `<a target="_blank">`. Change both mappings: if `href?.startsWith('#t=')`, render the existing `TimestampLink` component (it already calls `useVideoStore.setSeekTo`; it is tested). Delete redundant `web/components/MarkdownTimestampAnchor.tsx`.
2. Persist segments (a day): worker extracts `segments[]` (`worker/src/services/TranscriptExtractor.ts`) but never sends them. Add `segments` to the worker persist payload (`worker/src/routes/analysis.ts` + PersistService HMAC body) and to the persist route Zod schema, then call `SupabaseTranscriptAdapter.upsertTranscript` in `web/app/api/analyses/persist/route.ts` on finalize. Until this lands, the transcripts table is never written.
3. Redis L1 transcript cache: wrap extraction in `TranscriptExtractor` with get/set via existing `worker/src/services/UpstashCacheAdapter.ts`. TTL must be ≤ the 72h compliance window for verbatim transcript content (NOT 7d), or have the purge webhook DEL the Redis key.
4. QStash cron dedupe: script now matches by `scheduleId` but existing schedules were created with `name` → duplicates on next run. Before deploy, list schedules and delete legacy ones; make the script also match on destination URL.

## P4 — De-scope (delete or shelve; do not build)
- ffmpeg pass-2 as designed is unrunnable: no subprocess on CF Workers; Vercel 60s/500MB can't download+decode a 2h video; yt-dlp video download violates YouTube ToS regardless of env flag. Shelve `ffmpeg-enrich` (or keep as a pure marker-merge endpoint renamed accordingly). Future ticket: chapters from the YouTube player response the worker already fetches + storyboard sprite thumbnails (zero infra, ToS-clean).
- "60–90 semantic markers": no marker generator exists anywhere — remove the claim; if markers ship later, use the genre/length clamp table directly (the αβγδ formula degenerates to the clamp since drift/entityChurn aren't computable — no embeddings pipeline).
- Bayesian week-1 / bandit week-2 tuning: underpowered ~10× at current traffic (2.5 obs/param; 500 seeks detects only 15–20pp effects). Delete from roadmap until ~100× traffic.
- SSE timeline refresh: pointless without markers.

## P2.5 — qa-intel findings on the V5 diff (engine: `npx tsx scripts/verify-quality-engine.ts --mode=diff`, ran 2026-07-18)
1. `web/app/api/analyses/persist/route.ts` — HIGH ×2: empty `catch {}` blocks swallow errors silently (the new partial-markdown fallback's `try { reconstructMarkdown } catch {}` is one). Log the error with context before falling through.
2. `worker/src/services/TranscriptExtractor.ts` — HIGH: timeout abort does not settle error state; when the abort timer fires, set/propagate an explicit error rather than only calling abort().
(Full-mode also reports pre-existing repo-wide debt — empty catches in hooks, YAML injection in chat/capture-question, unvalidated DB writes in billing/admin routes, 307→303 in auth signin — out of V5 scope; track separately.)

## Verification gates (after P0–P3)
- `pnpm type-check`, web `pnpm build`, worker build.
- qa-intel: `npx tsx scripts/verify-quality-engine.ts --mode=diff` must show no NEW high-severity findings on touched files (advisory locally, blocks CI).
- Unit tests to add: dedup clustering (30 markers @4s spacing), linkify false positives (`16:90`, ISO datetime, inline code), Arabic digest headers, refusal-fallback rejection.
- E2E proof: re-analyze vEC6e5dBi4Y → expect md_len>0 with status `partial` OR `done` per validation, digest saved (or explicitly null with reason), transcript row present, timestamp click seeks player. Do NOT expect marker counts.
