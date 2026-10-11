# Highlights Ticker: ORIG./TRANS. Caption Toggle — Spec

Status: decision recorded 2026-10-10 (lead architect directive). UI stub shipped in PR #459.

## Decision

The primary source for the `TRANS.` toggle is **YouTube's native translated caption track**, fetched during ingestion. LLM generation is a fallback, used only when no native track exists for the video.

Order of preference per video:

1. Native translated track (YouTube `timedtext` with a translation target language) stored at ingestion.
2. LLM translation of the stored original-language segments, used only when step 1 yields no track.
3. If neither exists, the toggle stays on `ORIG.` and `TRANS.` is shown disabled.

## Current state (verified 2026-10-10)

- `worker/src/services/providers/YouTubeNativeTranscriptProvider.ts` reads the watch-page `captionTracks` list and downloads tracks by language with `timedtext?lang=`. It does **not** request a translated track (`tlang=`). The native-translation path therefore needs an ingestion change that is not yet written.
- PR #459 renders `TRANS.` as a stub ("Translation pending...") and changes no data.
- No translation pipeline exists in the codebase.

## Open items

- Ingestion change: request the translated track (`tlang=`) for the chosen target language, and persist it alongside the original segments. Not started.
- Verify that the target video actually exposes `translationLanguages` before relying on it. Availability per video is unknown until measured on a sample.
- Target language: the account's language setting is not defined. Pick one before the ingestion change.
- LLM fallback caching: decide the cache key and storage before any fallback is built.
