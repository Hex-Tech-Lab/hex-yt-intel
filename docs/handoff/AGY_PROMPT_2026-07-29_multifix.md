# AGY Dispatch — 2026-07-29 Multi-Fix Batch

Standing rules apply: read `.memory/AGENT_LEDGER.md` before touching any file, log `[IN_PROGRESS]`/`[DONE]` per task, qa-intel + typecheck + build before calling anything done, verify against real DB/API data — never claim "fixed" from code-reading alone.

## Task 1 — Video player black screen after chat timestamp click (P0, user-reported regression)

**Root cause** (confirmed via code read, not yet live-verified): `web/components/containers/DashboardContainer.tsx` renders `ChatDock` always-mounted (via the `dock={<ChatDock .../>}` prop) but only renders `VideoPlayerCard` when `activeNav === 'console'` (~lines 530-559). `TimestampLink.tsx` (used identically by both `ChatDock.tsx` and `SelectedDimensionReadout.tsx`) calls `useVideoStore.setSeekTo(seconds)` with no side effect beyond that. If a chat timestamp is clicked while `activeNav` is `'history'` or `'settings'`, `seekTo` is set in the store but no `VideoPlayerCard` exists to consume/clear it. On navigating back to `'console'`, `VideoPlayerCard` mounts cold, sees the stale `seekTo`, sets `interacted=true` (mounting the real YouTube iframe adapter — this is an async, several-hundred-ms-to-multi-second operation), but the component renders **no loading state while `!ready`** — the bare `containerRef` div is empty, and the outer wrapper's `bg-black` shows through as a black rectangle until either the adapter's `onReady` fires or the 30s `readyTimeout` in `VideoPlayerCard.tsx:61-69` gives up.

**Fix, two parts:**
1. `TimestampLink.tsx` (or `useVideoStore.setSeekTo`): when a timestamp is clicked, also ensure the console view is active — either have `TimestampLink` accept an `onBeforeSeek` callback that `ChatDock` wires to switch `activeNav` to `'console'`, or add a `pendingNav` flag to `useVideoStore` that `DashboardContainer` reads to force `activeNav='console'` on `setSeekTo`. Prefer the store-flag approach — keeps `TimestampLink` dumb and shared correctly between chat and transcript surfaces.
2. `VideoPlayerCard.tsx`: add a visible loading state (spinner or pulsing thumbnail) rendered whenever `interacted && !ready && !embedRestricted && !playbackError` — currently that gap renders nothing, which is the actual "black" the user sees even in the normal facade→player transition, not just the stale-seek case.

**Verification required**: reproduce live — open the app, navigate to History or Settings tab, open chat, click a timestamp link in a chat message, confirm it switches to Console and the video seeks/plays with a visible loading state instead of a black box. Also test the already-working path (click timestamp while already on Console) to confirm no regression.

## Task 2 — Chat history dropdown (backend already exists, UI missing)

`GET /api/chat/conversations` (`web/app/api/chat/conversations/route.ts`) already returns `persistenceAdapter.getConversations(identity.userId)` — full list, not scoped to current `analysis_id`. Build a date-stamped dropdown in `ChatDock.tsx` (or a new small component it composes) that:
- Fetches this list on chat panel open.
- Renders each conversation with a human-readable date/time and enough context (e.g. associated video title if available) to identify it.
- Selecting one loads that conversation's messages instead of the current/newest one.

Confirm scoping: verify each conversation is still ownership-checked per ADR 009/014 before rendering — don't trust the route to already filter correctly without checking.

## Task 3 — Duration dimension always shows "insufficient data"

Root cause confirmed: `web/lib/prompts/factory.ts`'s `getUCISPrompt` computes `duration` but only feeds it into `isShortForm`/`shortFormNotice` — never into `metadataJson` or any explicit prompt line the model sees for Dimension 2. `web/lib/prompts/ucis-v5.1.ts:130` has `| Duration | [HH:MM:SS] |` as a template row the model must currently infer from the transcript alone.

**Fix**: add the real duration (already available server-side) either into `metadataJson` as a `duration` field, or as an explicit line in the prompt output near where `isShortForm`/`shortFormNotice` are injected — e.g. `Video Duration (HH:MM:SS): ${formattedDuration}`. Format using the same `formatTime`-style helper already used elsewhere (check `VideoPlayerCard.tsx`'s local `formatTime` or search for an existing shared duration formatter before writing a new one).

**Verification required**: run a real synthesis against a video with known duration, confirm Dimension 2's Duration field in the output markdown matches the real video length, not a placeholder.

## Task 4 — Supabase Management API logs endpoint wrong URL

`web/lib/admin-logs/fetchers.ts`'s `fetchSupabaseLogs` hits `https://api.supabase.com/v1/projects/${projectRef}/logs?type=postgres` — confirmed via curl this endpoint doesn't exist (`Cannot GET`). The correct endpoint is `POST https://api.supabase.com/v0/projects/{ref}/analytics/endpoints/logs.all` (ClickHouse SQL dialect body, e.g. `{"sql": "select id, timestamp, event_message from postgres_logs order by timestamp desc limit 100"}`). The new token `sbp_v0_...` (already set as `SUPABASE_ACCESS_TOKEN` in Vercel — verify it's actually there via `vercel env ls` before assuming) authenticates successfully against this endpoint per manual testing this session; only the exact query syntax needs to be nailed down — start from the `postgres_logs` table name and iterate from generic "Backend error" responses by simplifying the SQL until one succeeds, then build back up to the fields the UI needs (timestamp, level, message/payload).

**Verification required**: a live successful call returning real postgres log rows, then confirm `/api/admin/logs/supabase` and the aggregate `/api/admin/logs/snapshot` both surface it correctly.

## Task 5 — Logs UI: timestamp dual-timezone + sortable headers

In whatever log-table UI renders provider results (`web/app/settings/logs/LogsViewerClient.tsx` or similar — confirm actual path first):
- Each timestamp cell shows both source-native time (usually UTC) and Cairo local time (e.g. `14:32:01 UTC · 16:32:01 CAI`).
- Table headers (Timestamp, Level, Source, Message/Payload) become clickable sort toggles.
- Default sort is reverse-chronological (newest first) on initial load, regardless of the order providers return.

No backend change needed — purely client-side rendering/sort logic against already-fetched data.

## Ledger note

Log all 5 of the above under `.memory/AGENT_LEDGER.md` as separate `[IN_PROGRESS]` lines with target files, not one combined entry — they touch disjoint files and can be worked/reviewed independently. Do not mark any `[DONE]` without the verification step listed for that task actually performed against live data/UI, not just a clean build.
