# THOS 2026-09-15 08:35 EEST — PR #309→#313 merge marathon, resilience RCA, tooling fixes

## Session continuity note
This session spans 2026-09-11 through 2026-09-15 (rate-limit pauses in between; work resumed each time via `<<auto-resume>>`). This doc is the single entry point to pick back up. **RESUME HERE.**

---

## 1. What's MERGED (main, confirmed)

| PR | Title | What it actually fixed |
|---|---|---|
| #305 | Retry a failed bundle once, don't abort on partial failure | Streaming resilience, ADR 021 phase 4 |
| #306 | Reaper salvage only bills at 100% | Billing correctness |
| #307 | qa-intel VariableNamingRule false-positive fix | Callback-arrow param exemption |
| #308 | Pre-launch checklist re-audit | Docs only |
| #309 | WAVE 10 qa-intel rules + **fatal self-check bug fix** | `UnregisteredRuleExportRule` was blanket-excluded from ever scanning its own target dir by `QualityEngine.analyze()`'s self-analysis suppression — replaced file-level exclusion with per-rule `allowSelfAnalysis` opt-in. Negative-control verified. |
| #310 | Bound remediation worker-failure retries + exclude transcript-purged candidates | Real 2026-09-01 incident: a retry storm burned the entire monthly remediation budget in 35 min; every tick since silently no-op'd for 10+ days |
| #311 | PR #310 post-merge review fixes | 3 P1 bugs: pagination-before-transcript-filter starvation, best-effort/swallowed failure-counter persistence, stale full-report overwrite race — fixed via new atomic `record_remediation_failure` RPC |
| #312 | Highlights transcript fallback, frozen dim count, stuck chips | User-reported 4-symptom RCA on video `gKgWYFOhZx0`: (1) highlights API camelCase/snake_case wire-contract regression from PR #281, (2) premature-finalize race freezing dimension count, (3) "insufficient data" confirmed NOT a bug (prompt's own protocol), (4) dishonest "100% complete" label + stale in-memory refetch guard blocking Channel Meta/Comments chips |

All of #309–#312 were independently gate-verified by CC (qa-intel:ci exit 0 un-piped, full vitest, tsc) before merge — not just trusted from agent reports.

## 2. What's OPEN right now — resume here first

### PR #313 — `fix/chat-wordcloud-stream-resilience` (OPEN, needs final CI check + merge)
https://github.com/Hex-Tech-Lab/hex-yt-intel/pull/313

User-reported incident on video `rDhaCLrdWHk` during a real internet disruption (2026-09-14, ~09:00-10:40 UTC): chat silently dropped messages, WordCloud missing on first load, status chips (Chapters/Channel Meta/Comments) stuck gray, a 500 opening WordCloud, and a recurring Sentry issue (`HEX-YT-INTEL-3E`, 18 occurrences since 2026-07-24).

**5-track RCA, all CONFIRMED with code + live evidence, all fixed:**
1. **Chat**: bouncer fetch had no timeout (stalled connection hung `sending=true` forever) + silent-drop guard + store error never rendered in UI. Fixed: 15s `AbortSignal.timeout`, visible error banner, bounded 3s outbox replay (server-side `clientMsgId` dedup makes this idempotent).
2. **WordCloud**: `useAutoRestoreAnalysis` gave up permanently+silently on transient fetch failure; `useKnowledgeGraph`'s fetch effect deps were `[analysisId]`-only so an `enabled: false→true` flip (entitlements resolving after mount) never re-fired. Fixed: bounded retries (5s/15s/60s) + `online` event re-arm on both hooks; `enabled` added to deps. **Live DB confirmed**: `kg_entities` had 15 real rows for `rDhaCLrdWHk` the whole time — this was purely a client display/refetch bug, not missing backend data.
3. **Chapters chip**: same "compute once, never refetch" bug class PR #312 fixed for Channel Meta/Comments, just in `useChapters` instead. Fixed the same way (refetch on next `online` event). **Live DB confirmed**: 15 real `transcript_chapters` rows existed the whole time.
4. **500 on WordCloud open**: structurally traced to `GET /api/analyses/[id]/graph`'s `verifyResourceOwnership` → `auth.authenticate()` throwing on a transient auth-provider hiccup → uncaught → 500. Exact user-visible render site not fully confirmable from code alone (flagged as a real open item, not swept under the rug).
5. **`HEX-YT-INTEL-3E`**: ruled out as the WordCloud-500 cause (different endpoint — the main analysis stream, not the graph route). Real root cause found: `extractJsonPayload`/`safeParse` in the worker captured every INITIAL parse failure to Sentry as an ERROR *before* the `jsonrepair` fallback even ran — so 18 "errors" were mostly successful recoveries mislabeled as failures. Fixed: initial failure → warn/breadcrumb only; only a genuinely unrecoverable `jsonrepair_failed` is a Sentry error now (tagged for correlation). **No historical data to check yet** — this tagging is new in #313, hasn't shipped, so `jsonrepair_failed` search in Sentry currently returns 0 (expected, not a red flag).
6. **Admin logs snapshot route gap** (found independently by CC, not user-reported): `/api/admin/logs/snapshot` only wired 7 of 10 real fetchers defined in `fetchers.ts` — `fetchSentryLogs`, `fetchOpenRouterLogs`, `fetchContractAuditLogs` existed but were silently unused. Fixed by CC directly (not OC — see collision note below), with a **regression-guard test** (`fetchers.test.ts` "snapshot route wiring") that reads both files' real source text and fails if a future new fetcher is ever added without being wired in. Negative-control verified.

**A real mid-session incident worth knowing about**: while OC was mid-dispatch in this exact worktree, CC (this session) edited the same file (`snapshot/route.ts`) to fix the same gap, then ran a careless `git checkout <file>` for an unrelated negative-control test that **discarded CC's own uncommitted fix** (not just the sed edit — the real one). Caught immediately, redone correctly, verified with tsc/tests, and explicitly logged in `.memory/AGENT_LEDGER.md` (both OC's collision note and CC's claim/apology). No data was permanently lost, but this is a **standing lesson: never run `git checkout <file>` in a worktree another agent process is actively writing to**, even for a "quick negative control."

**Current CI status (as of last check, commit `5c9673fc`)**: real `Lint`/`Pipeline Status` failures were found and fixed (CC's own mistake — checked with `--mode diff` instead of the exact CI command `qa-intel:ci` / `--ci --compare`; this project's own memory explicitly warns never to trust one mode alone, and CC repeated the exact error the memory warns about). Fixed: an empty test-cleanup `.catch(() => {})` (false positive, given a documented no-op body), a redundant `async` with no `await`, and an import-order violation (`@sentry/cloudflare` must precede `vitest`). Re-verified clean (`qa-intel:ci` exit 0, both touched tests pass). **Next action: re-check `gh pr checks 313`, confirm real CI (Lint/Pipeline Status/Unit Tests) is green, then merge** (Codacy/DeepSource/CodeFactor failures are the established non-blocking advisory class per this repo's PR Confidence Calculator philosophy — same pattern as every prior PR this session).

### `fix/pr312-review-findings` worktree (OC dispatch, STILL RUNNING as of this doc)
`.claude/worktrees/oc-pr312-review-findings`, no PR yet. Fixing a Cubic-style post-merge review of #312:
- **P0**: parent finalization in `persist/route.ts` isn't an atomic/idempotent `processing→terminal` guard — concurrent retries could double-finalize, duplicate side effects (digest/highlights/QStash publishes), or overwrite a newer result with a stale one.
- **P1a**: a malformed-but-nominally-`completed` chunk could be silently dropped during the `isFullySettled` settled-partial stitch (real data loss, no `failed` marking).
- **P1b**: the payload-less-chunk discriminator only checks `!validPayload` — a truthy-but-malformed payload (`{}`, `{foo:'bar'}`) might still slip through into the premature non-chunk finalize path, reopening #312's original bug via a different shape.
- **P2a**: `useAuxElementStatus`'s one-shot refetch guard (the #312 fix) is set BEFORE the fetch succeeds — React StrictMode's double-invoke or a transient failure can permanently consume it without ever completing a real fetch.
- **P2b**: highlights validator's `verbatimExcerpt`/`takeawayIdx` are `.optional()` — a future regression back to snake_case would pass validation silently again, defeating the point of pinning the contract.

**Watch for a file conflict**: this branch and #313 may both touch `web/app/api/analyses/persist/route.ts`. The dispatch prompt was told to report the conflict rather than force-resolve — check the ledger for how it actually played out.

**Next action**: check `ps aux | grep "opencode run"` and the worktree's git log/ledger for completion. If done, independently re-verify gates (the real `qa-intel:ci` command, not `--mode diff`) before pushing/opening a PR — don't repeat the mode mistake from #313.

---

## 3. Tooling / environment fixes made this session (durable, not per-PR)

1. **opencode dispatch pattern established**: `opencode run "<task>" -m openrouter/z-ai/glm-5.3-flash --variant low --title "<name>"`, always `nohup ... > /tmp/oc-<name>.log 2>&1 & disown` (backgrounded), always in an isolated `git worktree`, always with the dispatch prompt file physically copied into that worktree (it's a **separate checkout** — an uncommitted prompt file in the main checkout does NOT appear there). Monitor via the `Monitor` tool polling `kill -0 <pid>`.
2. **opencode needs frequent relaunches** — it reliably runs out of steam mid-task (upstream 504 timeouts, permission-sandbox halts on any path outside its own worktree including `/tmp`, or just stopping without finishing the gate/commit/push sequence). Always check `git log`/`git status`/ledger before assuming a `[DONE]` — relaunch with `-c` (continue same session) and a corrective note when it stops short. This happened 4-5 times across every dispatch this session; budget for it.
3. **Global `npm` is broken** on this machine (`Cannot find module '.../npm-cli.js'`) — a pre-existing, unrelated corruption. Use **`pnpm`** for anything global (`pnpm add -g <pkg>`) — confirmed working.
4. **TypeScript LSP installed and working**: `pnpm add -g typescript-language-server typescript` (the official Anthropic `typescript-lsp` plugin was already cached/in-use but had no binary). The `LSP` tool now works — used it for a real, fast, reliable cross-file enumeration (confirmed exactly 10 exported fetchers in `fetchers.ts`, no hidden ones) instead of grep guessing.
5. **`~/.config/opencode/opencode.json` had an invalid `lsp.disabled: false`** (schema wants an object or the key omitted, not a bare boolean) — blocked opencode from starting at all. Backed up (`opencode.json.bak-<timestamp>`) and removed the `lsp` block. If opencode ever fails immediately with a "Configuration is invalid" error again, check this file first.
6. **qa-intel has two meaningfully different check modes** — `--mode diff --base origin/main` (what CC kept reaching for) vs `qa-intel:ci` / `--ci --compare` (what CI actually runs). They can disagree. This project's own memory already said "always check diff AND full/ci mode" — CC repeated the mistake this session anyway (caught on #313). **Always run the exact `pnpm run qa-intel:ci` command before declaring a branch clean, not just `--mode diff`.**
7. **Cloudflare Observability MCP tool has a real server-side schema bug** (`$workers.outcome` required-string but some real log rows have it undefined → whole response rejected) — queued as feedback, not fixed, genuinely blocks pulling CF Worker execution logs via that tool right now.

## 4. Standing open items (not urgent, not forgotten)

- **`NE-62S4OYCg`** ("Lazy AI Side Hustle" video, 0/11 dims, failed twice identically) — root cause still NOT confirmed. Ruled out: budget exhaustion, transcript-missing, oversized context. Needs direct Cloudflare Worker dashboard log pull (blocked by the MCP tool bug above) for windows `2026-09-08T16:50-17:40Z` and `2026-09-10T08:20-09:10Z`.
- **500-render-site for WordCloud** (item 4 in PR #313's RCA) — code-only investigation exhausted, needs live reproduction or logs to pin exactly where the 500 surfaces to the user.
- **`jsonrepair_failed` Sentry check** — re-check after #313 ships; currently 0 results because the tag is new.
- Two SendFeedback drafts queued locally this session (never sent without explicit approval): the Cloudflare Observability MCP schema bug, and the ts-morph stale-content bug found while auditing PR #310's follow-up (qa-intel's `SourceFile.getText()` returned different/shorter content than the real file at the same path — worked around, not root-caused).

## 5. Key durable facts worth not re-deriving

- Remediation budget architecture (ADR 019) + the 2026-09-01 incident + PR #310/#311's fix are DONE — don't re-investigate "why isn't remediation working," it's fixed.
- `docs/private/` is git-untracked and confidential — it does NOT exist in any worktree, including OC's. Never ask OC to read it; it will fail (and correctly get sandboxed if it tries to reach into the main checkout for it).
- OC's sandbox rejects ANY path outside its own worktree, including `/tmp` — always tell it explicitly to keep scratch files inside the worktree.
- This repo's non-required CI checks (Codacy, CodeFactor, DeepSource) fail on nearly every PR this session for pre-existing/informational reasons and do NOT block merge (no branch protection requires them) — this is the established, correct pattern, not something to chase to zero every time. The REAL gates are Lint / Type Check / Unit Tests / Pipeline Status / Build.
