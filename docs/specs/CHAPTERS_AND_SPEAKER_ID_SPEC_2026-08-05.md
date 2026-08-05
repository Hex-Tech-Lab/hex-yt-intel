# Chapters + Speaker Identification — Scoping Spec (2026-08-05)

## Origin

Raised during live-test triage while comparing the `baoyu-youtube-transcript`
skill against our own pipeline (`docs/agent-prompts/2026-08-05-*`). The skill
does both; we do neither. Chapters in particular have a direct payoff for two
already-known bugs: entity time-seek (#6) and dimension timestamp links
(#17) both currently rely on regex-matched timestamps inside LLM-generated
text — a real chapter boundary is a much more reliable anchor than a regex
guess.

Not a bug fix. New ingestion-time scope, touching the transcript pipeline
contract and the schema from ADR 012 (`docs/history/...`, migration
`20260718000000_add_transcripts_and_markers.sql`).

## Existing schema (relevant columns only)

```sql
public.transcripts (video_id pk, content, segments jsonb, language, expires_at 72h, ...)
public.transcript_markers (
  id, video_id, idx, start_seconds, end_seconds,
  keywords[], entities[], quote_hash, importance, dim_refs[],
  genre text default 'unknown', source text default 'drift', ...
)
```

`transcript_markers.genre`/`source` are already free-text discriminator
columns — this suggests markers were designed to hold more than one kind of
thing. Neither table has a `label`/`title` field, which both chapters and
speaker turns need.

## Part 1: Chapters

**Source**: YouTube video descriptions frequently contain lines like
`0:00 Introduction`, `2:15 Topic A` (the `baoyu-youtube-transcript` skill's
parser is a working reference implementation, not something to import —
it's a few dozen lines of regex + string split, reimplement natively).

**Where it plugs in**: `worker/src/services/MetadataScraper.ts` already
fetches `snippet.description` (confirmed present in the same response that
gives us `snippet.title` at line 386) — chapter parsing is a pure-function
transform on data we already fetch, no new API call.

**Storage options** (pick one, don't do both):
- (A) Reuse `transcript_markers` with `genre='chapter'`, add a `label text`
  column via migration, `dim_refs` left empty. Pro: no new table, existing
  indexes (`video_id, start_seconds`) already fit chapter lookup. Con:
  `transcript_markers` semantics get slightly overloaded (it also holds
  "drift" markers from something else — read `source='drift'` usage before
  assuming this is safe to share).
- (B) New `transcript_chapters(video_id, idx, start_seconds, end_seconds, label)`
  table, same 72h TTL/purge pattern as `transcripts`. Pro: clean separation,
  no risk of colliding with whatever `source='drift'` markers are used for.
  Con: one more table, one more purge-function wire-up.

**Recommendation**: (B). `source='drift'` is unexplained from this pass —
verify what it means before reusing that table; a dedicated table is one
migration and avoids the risk entirely.

**Consumption**: `findEntityTimestamp` (`web/lib/utils/entity-time-seek.ts`)
gets a new first-choice path — if a chapter's time range brackets the
dimension content the entity came from, use the chapter start instead of
falling through to regex matching. This is an *additive* fallback tier, not
a replacement — regex matching stays as the fallback when no chapter data
exists for a video (most already-analyzed videos won't have it retroactively).

**Estimate**: small — 1 migration, ~40 lines of parser in the worker,
~15 lines of consumption logic in `entity-time-seek.ts`. No new LLM cost.

## Part 2: Speaker identification

Fundamentally different: YouTube gives us no speaker data. Two real options:

1. **Audio diarization** — a real ML step (e.g. pyannote, AWS Transcribe
   speaker labels). Requires the raw audio file, which this project
   deliberately does not download (ADR/legal note: yt-dlp avoided for legal
   risk — audio diarization needs the same audio access yt-dlp would
   provide, so this option is blocked by the same policy that blocked
   yt-dlp, not just an implementation cost). **Not viable under current
   legal constraints.**

2. **LLM-inferred turns from transcript text** — give a cheap model the raw
   transcript + title + channel + description, ask it to infer speaker
   turns from conversational cues (Q&A patterns, name mentions, host/guest
   framing). This is exactly what `baoyu-youtube-transcript`'s `--speakers`
   mode does. It is a *heuristic*, not ground truth — works reasonably for
   interview/podcast-style content, degrades on monologue or fast-crosstalk
   content, and will occasionally mislabel. **Viable, cheap, matches this
   project's existing model-cascade cost posture** (ADR 003/011).

**Recommendation**: option 2 only, and only for videos where it's likely to
add value — gate it behind a heuristic (e.g. transcript has >N distinct
"?" question density, or channel category suggests interview format) rather
than running it on every video, since a monologue video gains nothing from
a speaker-turn pass and it's pure added LLM cost for zero benefit there.

**Storage**: extend `transcripts.segments` jsonb (already exists, already
per-video) with an optional `speaker` field per segment rather than a new
table — segments are already the right granularity, no join needed at read
time.

**Estimate**: medium — one new cheap-model prompt (new file under
`web/lib/prompts/`, versioned like `ucis-v5.3.ts`), one new pipeline stage
gated by the interview-heuristic above, `segments` schema is additive (no
migration needed, jsonb). Real cost impact needs an ROI estimate against
`remediation`-style budget tracking (ADR 019) before this ships broadly —
don't hardcode an always-on extra LLM call without checking budget impact
first, per the no-hardcoded-magic-numbers rule.

## Decisions (user sign-off, 2026-08-05)

1. **New dedicated table(s)** — do not reuse `transcript_markers`. Use as
   many separate tables as the data actually needs rather than overloading
   one (`transcript_chapters` for chapters; speaker turns live in
   `transcripts.segments` jsonb per the plan above, no separate table
   needed there).
2. **Speaker ID: opt-in v1** — manually triggered (a toggle/button), not
   automatic on every video. No interview-heuristic gate needed for v1
   since it's user-initiated; the heuristic can be revisited later if this
   becomes something we want to auto-run.
3. **Audio diarization confirmed blocked** — same legal constraint as
   yt-dlp (needs audio access). LLM-inferred-from-text is the only path.

## Not yet done

No code, no migration written. Decisions above are final for v1 — see
`docs/agent-prompts/2026-08-06-oc-chapters-and-speaker-id.md` for the
dispatch prompt.
