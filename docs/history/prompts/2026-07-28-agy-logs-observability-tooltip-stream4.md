# Task Batch: Live Multi-Provider Logs Console + Tooltip Primitive Refactor

Dispatched to AGY 2026-07-28. Landed as `d5602b37`.

## Context you need before touching anything

The current `/settings/logs` page (`web/app/settings/logs/LogsViewerClient.tsx`) is a shell: one tab ("Synthesis Log (In-App)") does a real live fetch from Supabase via `web/app/api/admin/logs/synthesis/route.ts`; the other four tabs (Vercel, Supabase, Cloudflare Worker, OpenRouter) are empty `<textarea>` paste-boxes with a static "missing token" message — there is ZERO fetch code behind them, they were never built, not just broken.

Two things already got fixed by the orchestrator this session, don't redo them:
- `worker/wrangler.toml` `[env.production.observability]` — was `enabled = false` at the parent level (which silently disabled the `.logs`/`.traces` sub-blocks under it even though those said `enabled = true`). Flipped to `true`, worker rebuilt and redeployed (version `da55acf7`). Cloudflare Workers Logs is now live going forward — historical data from before this deploy does not exist and never will.
- `worker/src/chat-stream.ts` `streamChatCascade()` now returns `{ content, servedByModel, servedByProvider, attempts }` instead of a bare string, and logs a structured `[chat-cascade:summary]` line with those fields per request. This is your primary tool for the "why did provider X serve instead of Y" question — it's a log query now, not something to reverse-engineer from OpenRouter's dashboard.

## Task 1 — Wire real live-fetch for the 4 dead tabs, add the missing ones

**Confirmed root cause for why they're dead**: the 5 required secrets (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`) exist as **GitHub Actions repo secrets** (verified via `gh secret list`) but were never mirrored into **Vercel project env vars**, which is what the deployed Next.js app's `process.env` actually sees. `QSTASH_TOKEN` / `QSTASH_URL` / `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` already exist as Vercel prod env vars (verified via `vercel env ls production`) — those are ready to use immediately, no new secret needed.

Steps, in order:

1. **Before writing any code**, list exactly which of the 5 GH-secret-only tokens you need moved into Vercel prod env vars and ask the user to do it (you do not have Vercel dashboard write access) — do NOT proceed past this point assuming they exist. Needed:
   - `VERCEL_TOKEN`, `VERCEL_PROJECT_ID` (Vercel Logs/Deployments REST API)
   - `SUPABASE_ACCESS_TOKEN` (Supabase Management API — Postgres/Auth logs)
   - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Workers Logs GraphQL Analytics API — needs `Logs:Read` / `Observability:Read` scope specifically; the legacy `CLOUDFLARE_API_KEY` in `web/.env.local` is present but empty and is a different, older auth style — do not reuse it, request a new scoped token)
   - OpenRouter: **no live-fetch is possible** — OpenRouter genuinely has no bulk log export API (this is the one tab where the existing "not available" messaging is correct). Keep it as paste-in, but move the copy off the fake "reason" framing used for the others (that implied a fixable token gap — this one truly isn't).

2. Add **3 new tabs for Upstash** (Redis, QStash, Vector) — these are three distinct Upstash products with separate REST APIs, not one combined tab. Confirm which Upstash credentials exist already (`UPSTASH_REDIS_REST_URL`/`TOKEN` are referenced in `worker/wrangler.toml` secrets list — check if a Vector index is even provisioned before building that tab; if not, build the tab disabled with an honest "not provisioned" state, don't fake data).

3. Add a **QStash** tab using the Vercel-side QStash REST API (`QSTASH_TOKEN` is already live in Vercel prod — build this one first as the proof-of-concept for the "live fetch actually works" pattern before tackling the harder Vercel/Supabase/CF integrations).

4. For each live tab, build a real `/api/admin/logs/<provider>/route.ts` following the existing `synthesis/route.ts` pattern (auth-gated, time-window query params, returns `{ logs: string }` or structured rows — your call, but see Task 2 for the UI this needs to support). Cloudflare Worker logs specifically: use the GraphQL Analytics API (`workersInvocationsAdaptive` / Workers Logs dataset), not `wrangler tail` (that's realtime-only, cannot be called from a serverless function, and cannot answer "what happened 10 minutes ago").

5. **Proof required for each tab you claim is live**: paste the actual JSON/text response from hitting the new route in a real request (not a mocked example), for a time window that has real data. A tab is not "done" on code-compiles — it's done when you've shown a real row of real data came back.

## Task 2 — Rebuild the log table UI to match the OpenRouter reference, add Activity/Usage

**Correction from an earlier draft of this prompt**: "move under Settings" is already done — `cef44a50 feat(settings): add Settings nav panel with link to System Logs page` landed before this batch, and `SettingsPanel.tsx`'s `SETTINGS_ENTRIES` already has a `logs` entry pointing at `/settings/logs`. Don't redo that. What's still actually missing:

Current state renders everything as one giant `<pre>` text dump (`LogsViewerClient.tsx` lines 266-269) — no columns, no zebra striping, no filters, nothing structured, even though the one working tab (`synthesis`) actually returns discrete events that could be tabular.

1. Add a **sibling Activity/Usage entry** to `SETTINGS_ENTRIES` in `SettingsPanel.tsx`, next to `logs`, surfacing the usage stats that already exist (find the existing usage-stats source — likely `usage_logs` table and/or whatever populates the account usage the user already sees elsewhere in the app; do not invent a new metric — reuse what's already computed).
2. Rebuild the log content area as an actual table: columns, alternating row background (zebra), sortable/filterable by at minimum time range (already exists) + provider/model + status/finish-reason — modeled on the OpenRouter Logs → Generations table (columns: Date, Model, Provider, App, Input, Output, Cost, Usage Type, Speed, Finish Reason). Reuse whatever table/list primitive the rest of the app already uses (check `@astryxdesign/core/List` used in `SettingsPanel.tsx` — don't introduce a new table component if one already exists in the design system).
3. This applies to the `synthesis` tab immediately (it already has real structured data — `analysisId`, `videoId`, `model`, `valid`, timestamp — parse the existing log-line format into columns instead of leaving it as raw text) and to every new live tab from Task 1 as they land.

## Task 3 — Tooltip primitive refactor (separate, smaller task)

User's instruction verbatim: **"I prefer nothing inline. Do the best solution with fallbacks as needed for everything, but ensure they are 1:1 mapped and in sync all the time."**

Current state: status badge tooltips (`primitives.tsx` `StatusBadgeProps.tooltip`) use a native HTML `title` attribute (inline, browser-default styling, no control over positioning — this is what produced the overlapping-tooltip visual glitch the user flagged, where the persona chip's native title tooltip rendered on top of the status badge row). Persona chips (`PersonaSelector.tsx`) use a separate `<Tooltip>` component from the design system.

1. Find the design-system `Tooltip` component already used by `PersonaSelector.tsx` — do not build a new one.
2. Migrate `StatusBadge`'s `title` attribute usage to that same `Tooltip` component so there is exactly one tooltip mechanism in the app, not two competing ones.
3. "1:1 mapped and in sync" — audit every place a badge/label has a tooltip and verify the tooltip copy actually describes that exact badge (no copy-paste drift), and that every badge that should have a tooltip has one (don't leave silent gaps).
4. Proof required: screenshot or driven-browser capture showing the migrated tooltip rendering correctly with no overlap, for at least the status-badge row and the persona row simultaneously.

## Task 4 — Stream 4 (dims [5,7,10]) JSON-truncation fix — gated on one missing fact

You already found (via real worker tail log, stream `stream-1785243700238-4iamp4q`) that Stream 4 succeeded at the LLMCascade layer in 95043ms but then failed at `extractJsonPayload` with a syntax error at position 10,914 of a 14,339-char payload — this is NOT a Vercel or Worker timeout, the stream completed; it's a malformed/truncated JSON payload from the model.

**Before touching `STREAM_BUNDLES` in `web/lib/config/synthesis.ts`**, pull the `finish_reason` field from that specific OpenRouter response (now capturable via Workers Logs once Task 1's CF integration is live, or via OpenRouter's own dashboard for that generation ID). This is the fact that decides which fix is correct:

- `finish_reason: "length"` → confirms a token-budget cutoff. Haiku 4.5 gets `maxTokens.haiku = 8192` from `worker/src/services/LLMCascade.ts:40` (`MAX_TOKENS_FALLBACK`, no `admin_settings` override exists — checked, no such column). 14,339 chars against an 8192-token budget implies ~1.75 chars/token, unusually dense for a cutoff — plausible for nested JSON but not proven by char-count alone, which is why this needs the actual field, not more inference. If confirmed, rebalance `STREAM_BUNDLES` so no single stream's combined dimension set can plausibly exceed the token budget (move dimension 10 to a lighter stream, or raise `maxTokens.haiku` if that's cheaper/safer — your call, justify whichever).
- Anything else (`"stop"`, `"content_filter"`, etc.) → the model ended normally but produced malformed JSON some other way. Rebalancing stream size won't fix that — you'd be looking at prompt/schema issues in the dimension-5/7/10 prompt construction instead. Report back with the actual field value and do NOT apply the rebalance fix if it doesn't say `"length"`.

## Non-negotiable process requirements (apply to ALL tasks above)

1. **End-to-end, not point-fix.** For every change, trace the full chain it sits in (e.g., for a new log route: DB/API credential → route handler → client fetch → render) and confirm each link actually works, not just the one you touched. Do this by driving the actual UI/API, not by reading the code and asserting it should work.
2. **Report tangents you find and fix them too**, flagged separately in your report with proof, unless they're clearly out of scope — then just flag, don't touch.
3. **Every "done" claim needs the actual evidence attached** — a real response body, a real screenshot, a real log line with real data. "I verified X" with no artifact attached will be re-verified from scratch and treated as unverified.
4. **If a claim can't be verified** (e.g., a token you need doesn't exist yet), say so explicitly and stop — do not build a component against data you're assuming will show up later.
