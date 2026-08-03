# Changelog

All notable changes to hex-yt-intel are tracked here going forward. Entries below `2.0.0` are a retroactive reconstruction from git history (988 commits, 2026-06-17 → 2026-07-29) done on 2026-07-29 after discovering `1.8.0` had gone unchanged for 40 days despite substantial breaking and additive work landing underneath it — see `[[feedback_always_semver_bump]]` in project memory for the standing rule this established.

Classification: **MAJOR** = breaking change to existing behavior, data, or operational safety. **MINOR** = new backward-compatible capability. **PATCH** = fixes only.

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
