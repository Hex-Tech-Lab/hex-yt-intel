# Changelog

All notable changes to hex-yt-intel are tracked here going forward. Entries below `2.0.0` are a retroactive reconstruction from git history (988 commits, 2026-06-17 → 2026-07-29) done on 2026-07-29 after discovering `1.8.0` had gone unchanged for 40 days despite substantial breaking and additive work landing underneath it — see `[[feedback_always_semver_bump]]` in project memory for the standing rule this established.

Classification: **MAJOR** = breaking change to existing behavior, data, or operational safety. **MINOR** = new backward-compatible capability. **PATCH** = fixes only.

## [2.7.0] — 2026-08-27 (MINOR)

### Added
- Paddle Merchant of Record billing integration — phases 1-3: checkout, webhook verification (`timingSafeEqual` + replay skew guards), subscription lifecycle (`user_subscriptions` + `user_tier` precedence `enterprise:4 > founder:3 > pro:2 > free:1`), and Paddle loop-breaker hardening (PR #270, `2b5d497d`, `11801528`).
- ADR 028 — Temporal SQLGraph: recursive CTEs for anchored entity traversal + 64-bit SimHash anchor mesh for cross-segment deduplication (`3a37b386`).
- Highlights auto-scrubber + Dub.co share infrastructure: `analysis_highlights` table, `HighlightsScrubber`/`HighlightsTrack`/`useSegmentPlayback` playback loop, public share reel (`PublicHighlightsReel`) with signed token, and Dub.co short links (PR #233 `4ed18dc1`, PR #258 `b30c0915`, PR #266 `c235ef08`).
- Highlights chat/reel consistency: duration clamping (`minSegmentDurationSeconds`/`maxSegmentDurationSeconds` via `SettingsRegistry`), `parent_takeaway_idx` 0-based linkage to Dim.0 takeaways, NULL-safety, verbatim excerpts, and grounded annotations (PR #268 `e0e55f1e`, `0c5ba6a9` eager QStash extraction on finalize).
- ADR 026 Phase 1 scaffolding: grounded entity extraction model cascade, `retention_policies` table, normalized `kg_entity_mentions` schema, and chunk-grouping function for entity extraction (`f0132377`, `ba309d45`, `8297c0d1`, `720e86bc`).
- Console Simple vs Pro view split + logarithmic node weight normalization (`eb81100f`, PR #243); fail-closed view gating for unauthenticated/premium routes (`dbb84a44`, PR #272).
- Real email/password sign-in for automated testing — `TEST_AUTH_BYPASS_SECRET` gated `/api/test-auth/login` exempt from session middleware (PR #256 `6ffe943b`).
- Dub `SettingsRegistry` config + TestSprite bypass registry + share button (`47befa3d`, PR #246); waitlist landing page + `waitlist_signups` table (`5fb30173`, PR #231).

### Security
- Zero-trust entitlements: `useEntitlements` now server-authoritative (`/api/billing/entitlements` is sole source), `user_metadata` cannot grant premium access, fail-closed during loading states, `activeUserIdRef` request cancellation on auth switch (PR #285 `17a651ce`, `98575795`).
- Worker CORS + callback-URL trust consolidated into single allowlist; hotfix for `getvintel.com` outage (`e0ffa130`, `02c82f59`).
- HMAC-signed chapter persistence (`POST/GET /api/videos/[videoId]/chapters`) decoupled from chunked-analysis lifecycle (carried from 2.6.2 scope if not already released — see PR #206).

### Changed
- Knowledge Graph caps aligned to `SYSTEM_REGISTRY` — `MAX_KG_NODES 24` / `MAX_KG_EDGES 18` enforced in Zod (`synthesis.ts`) and worker tsconfig path aliases resolved (PR #283 `b8c7b44a`).
- LLM prompt-parser alignment: `MAX_PROMPT_TAKEAWAYS=10`, 0-based `[Index X]` takeaway indices, cumulative ADR 029 attention-bounded duration budgeting via `calculateAttentionBoundedBudget` + `ParseHighlightsOptions` (PR #285).
- Supabase browser client now singleton `getSupabaseBrowserClient()` — eliminates `Multiple GoTrueClient instances` warning (PR #281 `de36e565`).
- Highlights reel UX: uncapped selection (removed arbitrary 4-12 cap), marker-track scrubber, Astryx/Obsidian-Escher redesign, pause/resume + nav wraparound + control-height parity (`515c186c`, `b30c0915`).
- Entity color taxonomy corrected — fixes monochrome WordCloud/MindMap/Knowledge Graph (`84ed269d`); Pricing UI overhaul (`ad2c4ea6`); Astryx Theme provider wiring (`c94ee35a`).

### Fixed
- Highlights resilience: bounded scrubber polling (3 attempts, 2.5s/5s backoff), `HighlightSegmentSchema` temporal invariant `end > start`, `safeParse` validHighlights-only gate, cumulative duration budgeting without silent overflow (PR #281, #285).
- Boundary hardening: `PaddleBillingAdapter` payload validation, `SupabasePersistenceAdapter` typed `entityType`, `PersistService` telemetry, and contract auditor silent-error returns (PR #280 `a5068762`).
- Graph hardening: POLE+O schema rejection handled, edge pruning with typed fallback, entity frequency accumulation, wordcloud data flow, and normalized weight bounds (`90d2efb6`, `df4baea3`).
- Chunked-analysis pipeline: vitest teardown race eliminated, `LLMCascade` aligned to `SettingsRegistry` SSOT, YouTube player infinite-remount loop fixed (`67158f54`, `6a91890f`).
- Worker deploy: explicit `wrangler --env production` target (`11ba7bc6`); CI: eslint/codacy monorepo ignore paths aligned (`2204cef0`); qa-intel import ordering fixes (`a80c3bec`).
- Highlights reel scrubber: Play button deadlock from PR #263 fixed (`0843c8e3`); `isReady` guard before `start()`/`jumpTo()` (`da8bb017`); QStash completion polling + 10-sample warm extraction verified (`3a3b6d6f`).
- Legal copy: ToS clauses 2.1-2.4 spacing, sub-processor ledger accuracy, last-updated date (`c2906ab8`, `a8b55056`, `b7e7f6d2`).

## [2.6.2] — 2026-08-06 (PATCH)

### Changed
- Chapter persistence decoupled from the chunked-analysis request lifecycle (PR #206): new `POST/GET /api/videos/[videoId]/chapters` (HMAC-signed), worker fires chapter parsing via `waitUntil` in parallel with the LLM stream instead of gating on chunk completion, new `useChaptersStore` Zustand store with per-video generation counters to guard against a reset-vs-in-flight-fetch race, fixed a self-cancellation bug that made the whole decoupled path non-functional, fixed a stuck-`'loading'`-forever bug under React Strict Mode's dev-only double-invoke.
- ADR 024: added happy-dom + React Testing Library, fixed a `vitest.config.ts` include-glob gap that meant no test could ever render a real component or hook (PR #212).

### Fixed
- 12 `SILENT_ERROR_RETURN_NO_TELEMETRY` contract-auditor findings — 9 real gaps (6 in the Upstash snapshot-poll route, 3 in the shared API client) now emit proper Sentry/console telemetry on failure instead of silently returning (PR #210).
- 16 `UNVERIFIED_ENDPOINT_NO_TEST` findings — rewrote tautological tests (mocks that never actually exercised production code) to genuinely bind to it, plus real reliability fixes surfaced along the way: QStash pagination/timeout handling and dimension-remediation timeout/fallback-observability gaps (PR #211).

### Ops note
Package version had drifted from the changelog (2.6.1 was documented here but never bumped in `package.json`) — this entry also corrects that.

## [2.6.1] — 2026-08-04 (PATCH)

### Security
- Rotated `STREAM_HMAC_SECRET` (Vercel production + preview, Cloudflare Worker) after discovering the previous value had been committed in plaintext to `scripts/deploy-hmac-secret.sh`'s git history — this repo is public, so the old value must be treated as permanently compromised regardless of removal from the current file. New value marked Sensitive in Vercel (write-only after creation). Git-history scrub (`git filter-repo`) tracked as a separate follow-up, lower urgency now that the live secret itself is rotated and dead.

## [2.6.0] — 2026-07-29 (MINOR)

### Added
- UCIS prompt bumped to v5.3. Channel-level authority data (`subscriberCount`, `channelVideoCount`, `channelPublishedAt`) now reaches the analysis prompt for the first time -- audited the full output of a real completed analysis and found Dimension 2.3, 11.1, and 11.6 independently asking for subscriber count/channel age/upload cadence three separate times, always answering Insufficient Data. Root cause was two-layered: `MetadataScraper.fetchChannelDetails` never requested YouTube's `statistics` API part at all, and separately, the channel-metadata already being fetched (via a different, Decodo-scrape-based path) was threaded to the persist/chat-grounding call but never merged into the actual analysis prompt's metadata. Both fixed: the typed YouTube Data API fetch now runs in parallel with the existing Decodo fetch and merges under stable key names, and the merged result now reaches the prompt, not just persistence.
- Chat history dropdown titles now truncate to a fixed 26 characters + "..." (was inconsistent CSS ellipsis behavior against the flex-positioned date), full title available via hover tooltip.

### Audit notes
Full-document review of a real "seafood pasta" analysis found 11 total Insufficient-Data occurrences. 4 were the already-fixed Dimension-11 persona-parity bug (predates the 5.2 fix), 1 was the already-fixed Duration bug, 3 were the new channel-stats gap above, and 3 were legitimate correct uses of the protocol (no false negatives found in that sample).

## [2.5.0] — 2026-07-29

### Added
- Contract Auditor (`scripts/contract-auditor.ts`) — systemic detector for silent-success-on-missing-config, unverified external API endpoints, and prompt templates that pre-script a failure outcome. Runs in CI, persists to `contract_audit_runs`, surfaced in a new Settings > Logs "Contract Audit" tab.
- OpenRouter Activity API wired in as a live log source (`/api/admin/logs/openrouter`), replacing the paste-in placeholder.
- Snapshot History timestamps now use the same dual-timezone (UTC + Cairo) format as the main log table.

### Fixed
- QStash cron registration: the missing-credential path exited 0 (silent CI success) instead of failing, letting the `QSTASH_TOKEN` GitHub secret sit empty for 2+ months with zero schedules ever actually registered (reaper, transcript purge, compliance check, wiki builder, oracle dedup, snapshot poll). Token rotated, all 6 schedules re-registered, script now fails loudly on missing config.
- Supabase Management API logs endpoint: corrected to `GET /v1/projects/{ref}/analytics/endpoints/logs.all?sql=...` (previous attempts used a nonexistent path, then a wrong POST+JSON-body variant).
- Video player black-screen after a chat timestamp click while off the Console tab (stale `seekTo` + no loading state during YouTube iframe init).
- Chat history dropdown now lists all conversations (was video-filtered).
- UCIS prompt Dimension 11 (Monetization) previously pre-scripted an insufficient-data outcome for the Researcher/Product Manager personas by template design, not by transcript limitation — both now get the same real-attempt instruction as the other three personas. Bumped prompt to v5.2 in the same pass.
- Video duration wasn't injected into the UCIS prompt context, so Dimension 2's Duration field always fell back to a placeholder despite the real value being available server-side.

### Known issues (not yet fixed)
- `web/lib/embeddings.ts`'s `generateSparseVector` has a dead noise-filter: `MIN_TERM_SIGNAL_THRESHOLD = 0.15` can never trigger because the minimum possible term value (`Math.log(2) ≈ 0.693`) already exceeds it. The `3.5x` priority-term boost is an uncalibrated magic number.
- Astryx Toast reportedly renders with a white/unreadable background in production; a dark-mode CSS override exists and targets verified-correct attributes but could not be reproduced live this session to confirm the fix actually works.
- Navigating away from `/dashboard` (e.g. to Settings > Logs) mid-analysis aborts the stream; the worker gracefully persists partial progress as `interrupted` rather than crashing, but the UI messaging ("stream ended unexpectedly") doesn't reflect that this was an intentional client-side abort.
- Logs page date-range picker needs a full rebuild (2-click start+end range picker, Astryx-only).

## [2.4.0] — 2026-07-27 → 2026-07-28 (MINOR)
Knowledge-graph embedding tuning (sparse vector scaling, entity boosting — see known issues above), Admin Settings/Logs console (multi-provider live log routes, structured tabular UI).

## [2.3.0] — 2026-07-25 → 2026-07-26 (MINOR)
Astryx design-system full rollout — every component layer (atoms through organisms) converted across 4+ rounds.

## [2.2.0] — 2026-07-23 → 2026-07-25 (MINOR)
Settings Registry + role-based access matrix, Vault-backed prompt storage, Comments Sampling Engine (Phases 0-5) + Cloudflare Queue + credit wallet, video-ID-scoped chat grounding fallback (ADR 014).

## [2.1.0] — 2026-07-05 → 2026-07-19 (MINOR)
Stuck-analysis reaper (ADR 007), Dimension-0 executive digest (ADR 010), LLM model routing policy formalization (ADR 011), PR Confidence Calculator fail-closed fix (ADR 015), research-harness API key rotation policy (ADR 016).

## [2.0.0] — 2026-07-07 → 2026-07-19 (MAJOR — breaking)
- Chat Grounding Security Gate (ADR 008): chat now refuses rather than answering from general knowledge when no usable analysis is grounded — a behavior change from prior sessions.
- Chat Conversation↔Analysis Ownership Binding (ADR 009): owner-verified at creation, userId-scoped grounding read — breaking for any pre-existing unbound conversations.
- Ephemeral Transcript Storage & 72h Compliance Retention (ADR 012): transcripts now purge after 72h where they previously persisted indefinitely — a data-lifecycle breaking change.
- CI-Automated Production Schema Migration (ADR 013): `supabase db push` now runs on every push to `migrations/` with no manual gate — an operational-safety change, not user-facing but real.

## [1.8.0] and earlier
Not retroactively classified — see `git log` for full history prior to 2026-06-17.
