# Audit Part 1 — Timeline Boundary & Commit/Ledger Inventory

## Boundary

CC's (Claude Code's) last ledger `[DONE]` before the gap: **2026-08-20T21:07:40+03:00** — "Text/copy rebrand hex-yt-intel -> vIntel complete on branch `docs/rebrand-vintel` ... Pushed, not merged -- reporting to CC session for verification." (ledger line 1272)

That branch merged as commit **`ba94b9bf`** — `docs(web): rebrand text/copy to vIntel (#261)`.

**Boundary commit: `ba94b9bf`. Current HEAD: `7025aa74` (2026-09-05... actually committer date 2026-08-30T20:05:09+03:00).**

Note: HEAD's commit date is 2026-08-30, not 2026-09-05 — the "10 days" the user referenced runs from 2026-08-20/21 to roughly 2026-08-30/31 in repo activity terms (today's system date is 2026-09-05, so the last ~5-6 days have **zero commits** — worth flagging as its own data point: either work stalled, or it's happening in a state this audit can't see).

## Commit Inventory (`ba94b9bf..HEAD`, 62 commits)

By area (diff --stat, lines changed):
| Area | Files | Lines +/- |
|---|---|---|
| `web/` | 124 | +8590 / -1459 |
| `docs/` | 114 | +19907 / -189 |
| `worker/` | 12 | +212 / -222 |
| `supabase/migrations/` | 6 | +286 / 0 (6 new migrations, none deleted) |
| `.memory/` | 3 | +208 |

By rough type (from commit message prefixes): `fix:` dominates (~34 of 62), then `feat:` (~6), `chore:`/`docs:`/`refactor:`/`style:` making up the rest. No commit messages carry explicit `[AGY]`/`[OC]`/`[CC]` tags — agent attribution only exists in the ledger, not git history.

Major workstreams visible in the commit sequence:
1. **Highlights-reel rework** (largest single thread) — redesign, scrubber, playhead, verbatim captions, cardinality/DAG fixes, budget adaptation — commits `c235ef08` through `82fc8732`, ~25 commits.
2. **Paddle MoR billing** — `2b5d497d`, `11801528`, plus SSOT/entitlements hardening (`32175b5b`, `41101bde`, `6ed7c492`).
3. **Knowledge Graph / console simple-pro split** — `eb81100f`, `dbb84a44`, `df4baea3`/`96151a74` (duplicate-looking commit pair, see risk note), `90d2efb6`, `b8c7b44a`.
4. **CI/tooling hygiene** — Codacy/eslint monorepo path fixes (`2204cef0`, `c3352ee8`, `81206544`), nanoid pin (`1c4f8fb0`), wrangler env fix (`11ba7bc6`).
5. **ADR 028 (new, not in CLAUDE.md's table)** — `3a37b386 feat(adr028): temporal SQLGraph recursive CTEs and 64-bit SimHash anchor mesh (#269)` — **this ADR is not documented in CLAUDE.md's ADR ledger table at all**, a process gap (Part 2 should confirm).
6. **Prelaunch gap audit** — final two commits `82fc8732`/`7025aa74`.

## Ledger Volume & Dangling Items

Ledger lines in the window (≥2026-08-20T21:08): **~99 entries**, split ~30 `[IN_PROGRESS]` / ~60 `[DONE]` (rough grep count, includes some overlap from multi-line entries).

**Dangling `[SINK: ...]` workflows (IN_PROGRESS logged, no matching DONE found in ledger):**
- `[SINK: Highlights Reel Not Rendering — RCA + Fix]`
- `[SINK: PR #267 Remediation]`
- `[SINK: PR #267 squash-merge path — fix/pr267-consistency-v2]`
- `[SINK: simple-pro-kg-ui-split-and-bug243]` (a differently-worded DONE line 1325 likely closes this one out — probably a false positive from exact-string matching, but flagged for manual confirmation since PR #267/consistency threads are less clear.)

**Notable dangling non-SINK entry — a prior CC session, not this one:**
```
[2026-08-22T18:00:00+03:00] [CC (Claude Code)] [IN_PROGRESS] Resume & Verify:
Highlights/Chat/Digest consistency implementation completion. ... About to run
full skill stack ... before PR creation. Target: merge to main as PR.
```
No corresponding `[DONE]` from that CC instance exists anywhere later in the ledger. This is a genuine gap: an entire "Resume & Verify" pass over Highlights/Chat/Digest consistency was announced and never closed out in the ledger — either it silently completed and forgot to log, or it was abandoned. Given the volume of *subsequent* highlights/consistency fixes by AGY/OC (PR #267 remediation, #268, cardinality/DAG fixes through 82fc8732), it's plausible this CC review surfaced findings that were handed off informally and absorbed into later AGY/OC work — but that hand-off is not documented anywhere. **Recommend treating this as an open item**: no record exists that anyone ran the full mandatory skill stack (code-review-graph, qa-intel diff+full, contract-auditor, /simplify, code-reviewer, pr-review-workflow) specifically against the final highlights/chat/digest consistency state before it shipped piecemeal across many small PRs.

**Also notable — three `AGY-1` entries at 2026-08-26T14:xx and 2026-08-26T22:38 look like re-announcements of the same branch cut** (`fix/graph-integrity-and-wordcloud-flow` cut twice, `Cutting branch ... Tasks: 1)...5)` verbatim-duplicated at 14:58:55+03:00 and 22:38:21+00:00 — note the timezone switch from +03:00 to +00:00 mid-window, see Risk section) — likely a session restart re-stating scope rather than genuine duplicate work, but the identical task list text is suspicious enough to flag for the risk-scan fork to check whether `96151a74`/`df4baea3` (near-identical commit messages "harden entity frequency accumulation, wordcloud data flow, and normalized weight bounds") represent real duplicate commits.

## Timezone Inconsistency (flag for risk scan)

Ledger timestamps silently switch format partway through the window: entries through 2026-08-26T14:xx use `+03:00` (EEST, matches user's confirmed timezone), but entries from `2026-08-26T22:38:21+00:00` onward use `+00:00` (UTC) with no explanation, then later revert to `+03:00` around `2026-08-27T02:21:00+03:00`, then OC's `Muse Spark 1.2` entries from 2026-08-28/29 also use `+03:00`. This makes exact chronological ordering across agents unreliable for anything sub-hour and should not be used to infer true concurrency/collision windows without normalizing first.

## Handoff to Parts 2–4
- Part 2 (ADR/checklist) should confirm/deny ADR 028's absence from CLAUDE.md and check ADR 023/024 status.
- Part 4 (risk scan) should verify whether `df4baea3`/`96151a74` are true duplicate commits (possible double-apply) and treat the CC dangling `IN_PROGRESS` (2026-08-22) as an unresolved verification gap on the highlights/chat/digest consistency line of work.
