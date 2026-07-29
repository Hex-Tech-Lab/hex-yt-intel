# Changelog

All notable changes to hex-yt-intel are tracked here going forward. Entries below `2.0.0` are a retroactive reconstruction from git history (988 commits, 2026-06-17 → 2026-07-29) done on 2026-07-29 after discovering `1.8.0` had gone unchanged for 40 days despite substantial breaking and additive work landing underneath it — see `[[feedback_always_semver_bump]]` in project memory for the standing rule this established.

Classification: **MAJOR** = breaking change to existing behavior, data, or operational safety. **MINOR** = new backward-compatible capability. **PATCH** = fixes only.

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
