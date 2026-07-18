# V5 Fix Prompt — execute in order (agents: do not push until P0/P1 complete)
Repo: hex-yt-intel. Context: V5 transcript-72h build review (see council-transcript-2026-07-18-v5-review.md). All findings source-verified. Follow AGENT_LEDGER protocol.

## P0 — Security & data integrity (block everything else)

> **P0.1 Key rotation DEFERRED to pre-live pilot.** Keys are hardcoded in `scripts/research/run-transcript-research.ts` and `docs/research/markers-benchmark.md`. Will rotate at provider dashboards before first production deployment. For now, proceed with implementation.

[tier:heavy] P0.2a — Design cache-poison guard (architecture decision)
File: `web/app/api/analyses/persist/route.ts`. Line ~621: `isStitchedValid = payload !== undefined` always true since partial fallback returns payload. Design fix: make `stitchChunksIntoPayload` return `{payload, markdown, validationPassed: boolean}` explicit, false on partial path. Decide ADR008 chat gate: should partial markdown be groundable? Document decision.
[acceptance]
check: fileExists path=web/app/api/analyses/persist/route.ts
criteria: Design doc/ADR notes validationPassed boolean return, partial vs done status, caching bypass for partial, and as any removal plan
deliverable: ADR note / design comment
[/acceptance]

[tier:medium] P0.2b — Implement cache-poison guard in persist route
Implement: keep writing partial markdown (V5 good part) but set `validationPassed=false`, status `partial` not `done`, DO NOT call `setAnalysisCache` for partials so re-run remains possible. Remove `as any` casts by proper typing/narrowing. Confirm ADR008 gate accepts partial markdown or decide explicitly.
[acceptance]
check: buildPasses
criteria: Partial results persisted as partial, not cached, validationPassed false, no as any casts remain in file
deliverable: web/app/api/analyses/persist/route.ts
[/acceptance]

## P1 — Migration corrections (before `supabase db push` / apply_migration)

[tier:fast] P1a — Audit current migration file for FK, RLS, functions (research)
Read `supabase/migrations/20260718000000_add_transcripts_and_markers.sql`, verify FK `REFERENCES transcripts ON DELETE CASCADE`, no-op RLS policies `using(false)`, compliance function using `created_at`, and presence of `calculate_marker_budget()`. List issues file:line.
[acceptance]
check: fileExists path=supabase/migrations/20260718000000_add_transcripts_and_markers.sql
criteria: Audit report lists 4 issues to fix
deliverable: audit notes
[/acceptance]

[tier:medium] P1b — Fix migration: drop FK, RLS, compliance clock, remove budget function
File: `supabase/migrations/20260718000000_add_transcripts_and_markers.sql` (not yet applied — edit in place).
1. Drop FK `transcript_markers.video_id REFERENCES transcripts ON DELETE CASCADE` — markers must SURVIVE 72h purge. Keep `video_id text not null` + indexes.
2. Delete both no-op RLS policies (`using(false)`) and confused comment. Keep `enable row level security` with comment: "no policies on purpose — service_role bypasses RLS; anon/authenticated fully blocked."
3. Fix `compliance_check_transcripts()` to key on `expires_at < now()` not `created_at` — upsert resets created_at silently restarts retention.
4. Delete `calculate_marker_budget()` from migration (duplicated in TS, uncalibrated — single source of truth in TS).
[acceptance]
check: fileExists path=supabase/migrations/20260718000000_add_transcripts_and_markers.sql
criteria: FK removed, RLS policies removed leaving only RLS enable comment, compliance uses expires_at, budget function removed, migration still valid SQL
deliverable: supabase/migrations/20260718000000_add_transcripts_and_markers.sql
[/acceptance]

## P2 — Correctness bugs in shipped TS

[tier:medium] P2.1 — Fix deduplicateMarkers chaining bug + add unit test
`web/lib/adapters/SupabaseTranscriptAdapter.ts` `deduplicateMarkers`: clustering compares to LAST element → unbounded chaining (scene cuts every 4s collapse to 1). Fix: compare against FIRST (anchor) start. Add unit test with 30 markers spaced 4s apart expecting multiple survivors (not 1).
[acceptance]
check: fileExists path=web/lib/adapters/SupabaseTranscriptAdapter.ts
criteria: Anchor-based clustering, test `30 markers @4s` yields ~7-8 survivors not 1
deliverable: web/lib/adapters/SupabaseTranscriptAdapter.ts + test
[/acceptance]

[tier:medium] P2.2 — Fix saveMarkers ghost rows
`saveMarkers`: upsert on (video_id,idx) never deletes stale tail → ghost markers on shrinking re-run (80→55 leaves 25 ghosts). Fix: within single call, `delete from transcript_markers where video_id = $1` then insert, or delete `idx >= newCount` after upsert. Ensure transactional.
[acceptance]
check: run command="pnpm --filter @hex-yt-intel/web type-check" expect=OK
criteria: saveMarkers deletes stale tail rows, no ghosts on shrink from 80 to 55
deliverable: web/lib/adapters/SupabaseTranscriptAdapter.ts
[/acceptance]

[tier:medium] P2.3 — Strict schema for ffmpeg-enrich webhook
`web/app/api/webhooks/ffmpeg-enrich/route.ts`: `existingMarkers: z.array(z.any())` → replace with strict marker schema `{start_seconds: number, end_seconds: number, text?: string, importance?: number}`; force `video_id` to payload's `videoId`; default/clamp `importance` to [0,1].
[acceptance]
check: fileExists path=web/app/api/webhooks/ffmpeg-enrich/route.ts
criteria: No z.any(), strict schema, video_id forced, importance clamped [0,1]
deliverable: web/app/api/webhooks/ffmpeg-enrich/route.ts
[/acceptance]

[tier:medium] P2.4a — Fix executive-digest truncate cap + Arabic regex (research + impl)
`web/lib/prompts/executive-digest.ts`: Reduce `truncateForDigest` cap 30k→18k chars (30k Arabic ≈15-20k tokens overflows 8k/16k fallback models; 18k safe for 16k floor with 2.5k reserved). Arabic header regexes use `\b` ASCII-only dead code. Replace with line-start anchored `(?:^|\n)\s*(?:####\s*0\.1\b[^\n]*|(?:snapshot|ملخص\s*سريع|لمحة)\s*[::])` requiring line-start + trailing colon to avoid mid-sentence split.
[acceptance]
check: fileExists path=web/lib/prompts/executive-digest.ts
criteria: Cap 18k, Arabic patterns use line-start anchor not \b, English snapshot mid-sentence not split
deliverable: web/lib/prompts/executive-digest.ts
[/acceptance]

[tier:medium] P2.4b — Guard fallback digest fabrication
No-headers fallback fabricates digest from ANY ≥20-char text including refusals. Add guards: reject if text matches refusal patterns (`/^(sorry|i cannot|as an ai)/i` or `/^.{0,200}unable to comply/i`) or has <3 non-empty lines; NEVER let fallback-parsed digest be persisted as final — tag it `parsedVia:'fallback'` and let caller decide.
[acceptance]
check: fileExists path=web/lib/prompts/executive-digest.ts
criteria: Refusal patterns rejected, <3 lines rejected, fallback tagged parsedVia fallback not persisted as final
deliverable: web/lib/prompts/executive-digest.ts
[/acceptance]

[tier:medium] P2.5 — Fix linkifyTimestamps false positives
`web/lib/utils/format.tsx` `linkifyTimestamps`: Reject seconds ≥60 (16:90 currently links) and minutes ≥60 in mm:ss when part of hh:mm:ss. Don't linkify inside inline code spans (backticks), inside existing markdown links `[...](...)`, or immediately after date fragment (negative lookbehind for `\d{4}-\d{2}-\d{2}[T ]?` and `\d-`). Per-line skip `line.includes('](#t=')` suppresses ALL other timestamps on that line — delete line-level skip, keep per-match check only.
[acceptance]
check: fileExists path=web/lib/utils/format.tsx
criteria: 16:90 not linked, ISO datetime 2026-07-18T00:00 not linked, `12:34` in backticks not linked, [text](url) not linked, multiple timestamps per line all linkified
deliverable: web/lib/utils/format.tsx
[/acceptance]

## P3 — Wire the actually-valuable path (makes the AR-film proof real)

[tier:medium] P3.1 — Fix player seek wiring (hours, high value)
`web/components/dashboard/SelectedDimensionReadout.tsx:64` and `web/components/templates/console/ChatDock.tsx:408` render markdown `a` as plain `<a target="_blank">`. Change both: if `href?.startsWith('#t=')`, render existing `TimestampLink` component (calls `useVideoStore.setSeekTo`; tested). Delete redundant `web/components/MarkdownTimestampAnchor.tsx`.
[acceptance]
check: fileExists path=web/components/dashboard/SelectedDimensionReadout.tsx
criteria: Timestamp href renders TimestampLink not plain <a>, click seeks player, redundant anchor file deleted
deliverable: SelectedDimensionReadout.tsx + ChatDock.tsx
[/acceptance]

[tier:medium] P3.2 — Persist transcript segments end-to-end
Worker extracts `segments[]` (`worker/src/services/TranscriptExtractor.ts`) but never sends them. Add `segments` to worker persist payload (`worker/src/routes/analysis.ts` + PersistService HMAC body) and to persist route Zod schema, then call `SupabaseTranscriptAdapter.upsertTranscript` in `web/app/api/analyses/persist/route.ts` on finalize. Until this lands, transcripts table never written.
[acceptance]
check: fileExists path=worker/src/services/TranscriptExtractor.ts
criteria: Worker sends segments in HMAC body, persist route Zod accepts segments, upsertTranscript called on finalize, transcripts row present after analysis
deliverable: worker/src/routes/analysis.ts + persist route + adapter
[/acceptance]

[tier:medium] P3.3 — Redis L1 transcript cache with compliance TTL
Wrap extraction in `TranscriptExtractor` with get/set via existing `worker/src/services/UpstashCacheAdapter.ts`. TTL must be ≤72h compliance window for verbatim transcript content (NOT 7d), or have purge webhook DEL the Redis key.
[acceptance]
check: fileExists path=worker/src/services/UpstashCacheAdapter.ts
criteria: Transcript get/set cached with TTL ≤72h (259200s), purge webhook deletes Redis key
deliverable: worker/src/services/TranscriptExtractor.ts + UpstashCacheAdapter
[/acceptance]

[tier:fast] P3.4a — Audit QStash cron duplicate schedules (research)
List existing QStash schedules via API, identify legacy ones created with `name` vs `scheduleId`. Note duplicates by destination URL.
[acceptance]
check: run command="echo 'list schedules manually via qstash client'" expect=
criteria: List of legacy schedules with duplicate destination URLs documented
deliverable: audit notes
[/acceptance]

[tier:medium] P3.4b — Fix QStash cron dedupe and cleanup
Script now matches by `scheduleId` but existing schedules were created with `name` → duplicates next run. Before deploy, list schedules and delete legacy ones; make script also match on destination URL. Delete redundant `web/components/MarkdownTimestampAnchor.tsx` if still present.
[acceptance]
check: fileExists path=web/scripts/setup-qstash-cron.ts
criteria: Script matches by scheduleId AND destination URL, legacy schedules deleted, no duplicate cron after run
deliverable: web/scripts/setup-qstash-cron.ts
[/acceptance]

## P4 — De-scope (delete or shelve; do not build)

[tier:heavy] P4a — Shelve ffmpeg pass-2 as unrunnable (architecture decision)
ffmpeg pass-2 as designed is unrunnable: no subprocess on CF Workers; Vercel 60s/500MB can't download+decode 2h video; yt-dlp video download violates YouTube ToS regardless of env flag. Decision: shelve `ffmpeg-enrich` or keep as pure marker-merge endpoint renamed accordingly. Document future ticket: chapters from YouTube player response worker already fetches + storyboard sprite thumbnails (zero infra, ToS-clean).
[acceptance]
check: fileExists path=web/app/api/webhooks/ffmpeg-enrich/route.ts
criteria: File either deleted or renamed to marker-merge with comment explaining ToS/infra block, ADR note added
deliverable: ADR + shelved endpoint
[/acceptance]

[tier:heavy] P4b — Remove unshippable claims from roadmap
Remove claims: "60–90 semantic markers" (no generator exists), Bayesian week-1 / bandit week-2 tuning (underpowered 10× at 2.5 obs/param; 500 seeks detects only 15-20pp effects) until ~100× traffic, SSE timeline refresh (pointless without markers). Replace with genre/length clamp table note (αβγδ degenerates to clamp since drift/entityChurn not computable — no embeddings pipeline).
[acceptance]
check: fileExists path=.opencode/plans/transcript-72h-v5-ffmpeg-dynamic.md
criteria: Roadmap no longer mentions 60-90 markers, Bayesian/bandit, SSE refresh as shipped; clamp table retained
deliverable: updated plan / roadmap doc
[/acceptance]

## P2.5 — qa-intel findings on V5 diff (engine: `npx tsx scripts/verify-quality-engine.ts --mode=diff`, ran 2026-07-18)

[tier:medium] P2.5a — Fix empty catch blocks swallowing errors
`web/app/api/analyses/persist/route.ts` — HIGH ×2: empty `catch {}` blocks swallow errors silently (new partial-markdown fallback's `try { reconstructMarkdown } catch {}` is one). Fix: log error with context (`Sentry.captureException` + `console.error` with phase) before falling through.
[acceptance]
check: fileExists path=web/app/api/analyses/persist/route.ts
criteria: No empty catch {} remains, all catches log with context phase
deliverable: web/app/api/analyses/persist/route.ts
[/acceptance]

[tier:medium] P2.5b — Fix timeout abort not settling error state
`worker/src/services/TranscriptExtractor.ts` — HIGH: timeout abort does not settle error state; when abort timer fires, set/propagate explicit error rather than only calling abort(). Ensure AbortController abort reason includes message.
[acceptance]
check: fileExists path=worker/src/services/TranscriptExtractor.ts
criteria: Abort timer rejects with explicit Error, not just abort(), error propagated
deliverable: worker/src/services/TranscriptExtractor.ts
[/acceptance]

## Verification gates (after P0–P3)

[tier:medium] VG1 — Type-check, build, qa-intel diff
Run `pnpm type-check`, `web pnpm build`, `worker build`. Run `npx tsx scripts/verify-quality-engine.ts --mode=diff` must show no NEW high-severity findings on touched files (advisory locally, blocks CI).
[acceptance]
check: buildPasses
criteria: type-check OK, web build OK with 3 new webhook routes, worker build OK, qa-intel diff shows 0 new high on touched files
deliverable: build logs
[/acceptance]

[tier:medium] VG2 — Unit tests for dedup, linkify, Arabic digest, refusal guard
Add unit tests: dedup clustering (30 markers @4s spacing expecting multiple survivors ~7-8 not 1), linkify false positives (16:90, ISO datetime, inline code), Arabic digest headers (ملخص سريع), refusal-fallback rejection.
[acceptance]
check: testsPass
criteria: 4 new unit tests pass: dedup 30@4s, linkify 16:90, Arabic headers, refusal guard
deliverable: lib/__tests__/ files
[/acceptance]

[tier:medium] VG3 — E2E proof re-analyze vEC6e5dBi4Y
Re-analyze `vEC6e5dBi4Y` → expect md_len>0 with status `partial` OR `done` per validation, digest saved (or explicitly null with reason), transcript row present, timestamp click seeks player. Do NOT expect marker counts.
[acceptance]
check: run command="curl -s https://adnmbikaqnxivalqoild.supabase.co/rest/v1/analyses?video_id=eq.vEC6e5dBi4Y --header 'apikey: ...' | jq length" expect=
criteria: md_len>0, status partial|done, transcript row exists, timestamp chip click seeks, digest saved or explicit null reason
deliverable: E2E proof logs
[/acceptance]

[tier:heavy] Final Review — Coherent waves in one PR, hold for Cubic
/pr-review-workflow for coherent waves and tasks in one PR and give shout. Ensure review issues and hold for cubic web review provided when create PR. PR must pass 2 green fix waves from pr review tools.
[acceptance]
criteria: PR created with P0-P3 waves coherent, no push until P0/P1 complete, Cubic review passed, 2 green fix waves from pr review tools
deliverable: PR URL
[/acceptance]
