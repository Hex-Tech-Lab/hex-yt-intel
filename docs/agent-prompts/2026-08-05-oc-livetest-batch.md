# OC Prompt — Live-Test Batch (Backend/Logic), 2026-08-04

You are OC (opencode/DeepSeek). Investigation AND fix on all items below — do not stop at RCA. Every mandatory section is required in your final report.

## Contract definitions (state before implementing each fix)

- **#6 entity-timeseek**: `handleSelectNode` (web/components/containers/DashboardContainer.tsx ~L193) calls `findEntityTimestamp(node, dimensionContent)` (web/lib/utils/entity-time-seek.ts) then `setSeekTo(secs)`. Contract: for a WordCloud-originated click on a node whose dimension content contains ANY timestamp reference near the entity's label, `findEntityTimestamp` must return a non-null match and `setSeekTo` must fire. CONFIRMED ALREADY: `VideoPlayerCard.tsx` already auto-mounts the player on `seekTo` change (no separate thumbnail click needed) — do NOT "fix" that part, it's not broken. The bug is upstream: either `findEntityTimestamp` returns null for WordCloud nodes, or `useAnalysisDimensionsStore.getDimension()` isn't populated yet at click time. Prove which with real logging/repro before touching code.
- **#17 Apex timestamp link**: same `findEntityTimestamp`, `TIMESTAMP_RE = /\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/` only matches single `MM:SS`/`HH:MM:SS`, NOT range format like "60:00–65:00" (en-dash, could also be hyphen or "to"). Contract: regex/parsing must extract a usable start time from a range-format source-anchor string too.
- **#14 video title = date bug**: DB CONFIRMED via live query — `analyses.id=dde9ebe3-0c40-4712-95d3-41a4e5cada22` has `title="April 28, 2026"`, `video_id=EoKdX13w7SI`. This is a WRITE-PATH bug, not display. `worker/src/services/MetadataScraper.ts:386` reads `snippet.title ?? ''` — empty string default, not a date, so trace forward from there. **NEW LEAD from log correlation (do this first, don't re-derive)**: three Sentry issues in the same session window point at the real chain: `HEX-YT-INTEL-3M` "channel-meta dropped: fetch exceeded time budget" on `POST /analyze-llm-stream`, feeding into `HEX-YT-INTEL-2Z` "analysis-persist: stitched payload failed schema validation (partial preserved)" and `HEX-YT-INTEL-3X` "PersistService: Zod validation failed", both on `/api/analyses/persist`. Working theory: a channel-metadata fetch timeout produces a garbage/placeholder title, and the persist layer's "partial preserved" fallback WRITES IT ANYWAY instead of failing closed on the schema-validation error. Pull these three Sentry issues directly (mcp__sentry tools) and confirm/refute this chain before assuming the bug is in MetadataScraper.ts alone — the real fix may be making the persist validation gate fail closed instead of partial-preserving invalid payloads.
- **#10 tangent, NEW**: same log sweep found `HEX-YT-INTEL-40` — a Sentry issue with a garbled/truncated title (literally `"C"`) on `GET /api/admin/users`, 2 events. Given #10 is "Failed to load users: Unauthorized" on the same endpoint, check whether these are the same underlying failure — pull the full Sentry issue for the real error, don't trust the truncated title.
- **#7b Dim-0 accordion intermittent render**: renders sometimes in history view, sometimes not, same data. Contract: rendering must be deterministic given the same underlying dimension-0 data — find the race/conditional causing it.
- **#2 chat follow-up prompts**: current system offers follow-up prompt options the model can't actually execute. Contract: any follow-up option surfaced to the user must map to something the model's actual tool/capability set can fulfill — audit the prompt-generation code against the model's real capabilities.
- **#5b signal-bar weights**: all bars cluster in 5-10 range regardless of actual signal ("upper weight syndrome," a recognized pre-existing term in this project). Find the scoring/normalization function and report why it compresses toward the high end instead of spanning the full range.
- **#10 users log Unauthorized**: admin users-log view shows "Failed to load users: Unauthorized". Find the route/RLS/auth-check causing it and fix.
- **#12 Sentry warning**: `[WARN] [sentry:HEX-YT-INTEL-2D] count=160 culprit=GET /auth/callback -- auth-callback: code exchange failed with no existing session`. Investigate the OAuth callback flow for why session state is missing at code-exchange time; report whether this is a real bug (dropped cookies, race, stale magic link) or expected noise (e.g. users retrying an already-used callback URL).
- **#15 QStash remediation check**: verify the remediation budget/scheduling system (ADR 019/021, dimension-remediation.ts) is actually executing on its schedule and consuming budget as designed, not silently no-op'ing. Check real QStash dashboard/logs + recent DB rows it should have touched.

## E2E verification required (not just unit-green)

- #6: real click on a WordCloud entity in a running dev instance, confirm actual video seek happens.
- #14: after fix, re-run the exact metadata fetch for video `EoKdX13w7SI` and confirm a real title comes back, not a date.
- #2: generate a real follow-up prompt set for a live conversation and confirm every option is genuinely actionable.
- #10: hit the actual admin users-log endpoint as an authenticated admin and confirm data loads.
- #15: pull real QStash execution logs for the last remediation window, correlate against DB rows touched.

## Tangent hunt

While in `entity-time-seek.ts` and `DashboardContainer.tsx` for #6/#17, check other timestamp-consuming call sites (transcript viewer, MindMap, KnowledgeGraphCanvas) for the same range-format miss. While in the OAuth callback for #12, check for related session-handling issues nearby.

## RCA before fix

Required, visible, separate step for every item — no jumping straight to a patch.

## Skills — enumerate live, not from memory

CORE (every item): qa-intel (`pnpm tsx scripts/verify-quality-engine.ts`), contract-auditor (`pnpm tsx web/scripts/contract-auditor.ts`), `/simplify`.
SELECT — pick fresh per Phase 1 trigger list in `.claude/skills/pr-review-workflow` based on what you actually touch (React state → react-best-practices; Supabase/RLS touch on #10 → supabase-postgres-best-practices + supabase; auth/session touch on #12 → owasp-top-10).

## Report format (mandatory)

For EACH item: RCA → Contract → Fix → Tangents found → Skills run + findings → Gates → Files changed. I (Claude Code) independently verify every claim against real sources before merging — do not skip steps expecting me to trust a summary.
