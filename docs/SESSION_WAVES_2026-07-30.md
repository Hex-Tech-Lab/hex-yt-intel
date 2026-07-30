# Session Waves — 2026-07-30

Running checklist so nothing found mid-review gets lost. Update in place; don't create a new file per wave.

## Wave A — Persist-failure observability (DONE)

| # | Task | Status |
|---|---|---|
| A1 | Sentry.captureMessage on PersistService's 4 silent-failure paths (Zod fail x2, retry-exhausted x2) | ✅ done (e5bfc1da) |
| A2 | Log the settleAnalysis reconstructMarkdown catch (was silent) | ✅ done |
| A3 | Verify chunk-4 banner-undercount live against fresh DB data | ✅ done — current logic correct, not reproducing |
| A4 | Contract-auditor rule: SILENT_CATCH_NO_TELEMETRY (standing static check, not just the one-off qa-intel run) | ✅ done, includes single-line `catch { }` fix |

## Wave B — Sattam Majumdar login investigation (DONE)

| # | Task | Status |
|---|---|---|
| B1 | Verify Gemini's login-correlation analysis against live DB (don't trust the pasted chain) | ✅ done — corrected a false lead (ryf-0Z0Ba0E belongs to a different user) |
| B2 | Confirm real signup, real OAuth, single 3-min session, one video analyzed (aCKgXxYyTx8) | ✅ done |
| B3 | Extract and save the actual downloaded analysis markdown for review | ✅ done — `docs/for_sharing/Sattam-Downloaded-Analysis-59e03aaf.md` |

## Wave C — Admin User Activity dashboard (IN PROGRESS)

| # | Task | Status |
|---|---|---|
| C1 | SQL migration: `admin_list_users_activity()` + `admin_get_user_sessions()` RPCs over `auth.sessions` (not PostgREST-exposed by default) | ✅ done, applied, fixed ambiguous-column bug |
| C2 | `usage_logs` `report_download` event on PDF export (was untracked — confirmed zero download events existed) | ✅ done (export/route.ts) |
| C3 | Client-side MD download tracker (Blob download in DashboardContainer.tsx has no server hit today) | ⬜ not started |
| C4 | `/api/admin/users` route (list) + `/api/admin/users/[id]` route (sessions + analyses + downloads for one user) | ⬜ not started |
| C5 | `UsersAdminClient.tsx` — new Settings tab: user table (email, tier, signup, last session IP/UA, videos analyzed w/ links, reports downloaded w/ links) | ⬜ not started |
| C6 | Wire into `SettingsPanel.tsx` SETTINGS_TREE + SettingsContentPane | ⬜ not started |

## Wave D — OpenRouter request correlation (NOT STARTED)

| # | Task | Status |
|---|---|---|
| D1 | Check whether OpenRouter API calls can carry a per-request user identifier (header/field) so OpenRouter's own activity log can be cross-referenced back to our `users.email` | ⬜ not started |
| D2 | If supported, wire it into `worker/src/services/LLMCascade.ts` / `web/lib/services/openrouter.ts` call sites | ⬜ not started |

## Wave E — Video player black-screen fix (DONE)

| # | Task | Status |
|---|---|---|
| E1 | RCA: `setSeekTo` never set `isPlaying`, so a timestamp click before manual play mounted the player paused → black frame | ✅ done |
| E2 | Fix at the store level (`setSeekTo` now sets `isPlaying: true`) + defensive `play()` call in the already-mounted seek branch | ✅ done (`useVideoStore.ts`, `VideoPlayerCard.tsx`) |
| E3 | Live verify in browser (click a timestamp cold, confirm no manual-play-first requirement) | ⬜ not started |

## Wave F — Skill sourcing sweep (NOT STARTED, delegated when picked up)

| # | Task | Status |
|---|---|---|
| F1 | Brave + Exa + Decodo search for credible skills across FE/BE/Ops/etc, combine into one comparison report | ⬜ not started |
| F2 | Read candidates before install (trust boundary), then install | ⬜ not started |

## Wave G — Silent-catch sweep across worker (PARTIALLY DONE)

| # | Task | Status |
|---|---|---|
| G1 | Contract-auditor SILENT_CATCH_NO_TELEMETRY rule now runs repo-wide on every audit pass | ✅ done (part of Wave A) |
| G2 | Review the rule's actual findings output and triage each one | ⬜ not started |

## Wave H — UCIS Dimension 6 gap, second review batch (NOT STARTED)

| # | Task | Status |
|---|---|---|
| H1 | SOTU video review (long, dense, multi-topic) — original candidate | ⬜ not started |
| H2 | Sattam's video (Chhirag Kedia, "Momentum Master's Approach," 2h02m, English-Indian narration/Hindi captions, single-domain highly technical stock-trading content) added as 2nd candidate — same Dimension 6 "[Insufficient data]" pattern observed | ⬜ not started, candidate noted |
| H3 | Decide if this is systemic (Dimension 6 prompt needs the same "attempt real answer first" fix as the Monetization dimension SCRIPTED_TEMPLATE_FAILURE bug) or genuinely video-dependent | ⬜ not started |
