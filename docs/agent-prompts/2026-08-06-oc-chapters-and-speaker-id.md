# OC Prompt — Chapters + Opt-in Speaker ID, 2026-08-06

Spec: `docs/specs/CHAPTERS_AND_SPEAKER_ID_SPEC_2026-08-05.md` (read first —
this prompt assumes its decisions, don't re-derive scope). Two independent
features, can be split into two PRs if easier to review.

## Contract — Part 1: Chapters

- New migration: `public.transcript_chapters(video_id text, idx int,
  start_seconds double precision, end_seconds double precision, label text,
  created_at timestamptz default now(), unique(video_id, idx))`. Same 72h
  TTL/purge pattern as `public.transcripts` (see
  `supabase/migrations/20260718000000_add_transcripts_and_markers.sql` for
  the reference pattern — purge function, RLS enabled with no policies
  since service_role bypasses it, index on `video_id`).
- Parser: pure function in `worker/src/services/` (co-locate near
  `MetadataScraper.ts`) that extracts `0:00 Intro`-style lines from
  `snippet.description` (already fetched, confirmed present in the same
  response as `snippet.title` at `MetadataScraper.ts:386`). No new YouTube
  API call.
- Consumption: `findEntityTimestamp` (`web/lib/utils/entity-time-seek.ts`)
  gets a new FIRST-choice path — if a chapter's `[start_seconds,
  end_seconds]` range brackets the entity's dimension content, return that
  chapter's start instead of falling through to regex matching. Existing
  regex fallback stays untouched for videos with no chapter data (most
  already-analyzed videos won't have any — this must degrade gracefully,
  not throw or behave differently when no chapters exist).

## Contract — Part 2: Opt-in speaker ID

- Manually triggered only (a toggle/button in the UI) — NOT automatic on
  every video, no heuristic gating needed for v1, per sign-off.
- New prompt file under `web/lib/prompts/` (versioned like `ucis-v5.3.ts`),
  cheap model per existing cascade (ADR 003/011) — input: transcript text +
  video title + channel + description, output: speaker turns.
- Storage: extend `transcripts.segments` jsonb (already exists, already
  per-video, no migration needed for this part) with an optional `speaker`
  field per segment.
- Trigger surface: find the existing per-video settings/actions area (grep
  for where other opt-in per-video actions live, e.g. a Settings panel or
  action menu) and add a "Identify speakers" action there — server action
  or route that runs the prompt and writes back to `segments`.
- Cost: check actual $ impact against the remediation-budget pattern (ADR
  019, token-bucket in `web/lib/redis.ts`) before wiring it live — don't
  hardcode a call with no budget awareness, per the no-hardcoded-magic-
  numbers rule. If existing budget infra doesn't cover ad hoc user-
  triggered LLM calls (it may only cover the remediation sweep), flag that
  gap rather than silently skipping budget enforcement.

## E2E verification required

- Chapters: run against a real video with a description containing chapter
  markers, confirm `transcript_chapters` rows are created with correct
  `start_seconds`, and confirm an entity click on that video actually uses
  the chapter-derived timestamp (not the regex fallback) — check via
  logging or a temporary breakpoint, not just unit mocks.
- Speaker ID: trigger the new action on a real interview/podcast-style
  video, confirm `segments` gets `speaker` fields populated with plausible
  labels (not asserting perfect accuracy — a heuristic — but confirm it
  runs end to end and persists).

## Tangent hunt

While touching `entity-time-seek.ts`, check MindMap/KnowledgeGraphCanvas
consumption paths for the same chapter-vs-regex priority question — if they
call `findEntityTimestamp` too, they get the improvement for free; if they
have their own separate timestamp logic, flag it as a tangent (don't fix
unless trivial).

## RCA before fix

Not a bug fix, but still show your design reasoning at each decision point
(especially the chapters-vs-regex priority order and the segments schema
change) as a visible step, not just a diff.

## Skills — enumerate live, not from memory

CORE: qa-intel, contract-auditor, `/simplify`.
SELECT (per `.claude/skills/pr-review-workflow` trigger list, checked
fresh): new migration/table → `supabase-postgres-best-practices` AND
`supabase` (RLS, purge function correctness). New React state/component for
the speaker-ID trigger UI → `react-best-practices`. New button/toggle prop
surface → `composition-patterns`. `react-native-skills` does NOT apply —
confirmed no React Native code exists in this repo (standing project memory)
— do not invoke it.

## Report format (mandatory)

For EACH part: RCA → Contract → Fix → Tangents found → Skills run +
findings → Gates (tsc/vitest/qa-intel/contract-auditor/supabase-postgres-
best-practices results) → Files changed. CC independently verifies every
claim (migration actually applied and named per the `list_migrations`
version-matching rule in project CLAUDE.md ADR 018, real end-to-end test)
before merging — do not report a fix as done without on-disk evidence.
