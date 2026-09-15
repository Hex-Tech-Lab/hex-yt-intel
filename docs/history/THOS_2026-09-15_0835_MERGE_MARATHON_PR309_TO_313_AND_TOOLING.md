# THOS 2026-09-15 09:00 EEST — PR #309→#313 merge marathon, resilience RCA, tooling fixes, two new planned waves

## Session continuity note
This session spans 2026-09-11 through 2026-09-15 (rate-limit pauses in between). **User is restarting the session now — everything is on hold until they say "restarted."** This doc is the single entry point to pick back up. **RESUME HERE.**

---

## 1. What's MERGED (main, confirmed)

| PR | Title | What it actually fixed |
|---|---|---|
| #305–#308 | Streaming retry, billing salvage, qa-intel false-positive fix, docs | See prior THOS entries if detail needed |
| #309 | WAVE 10 qa-intel rules + **fatal self-check bug fix** | `UnregisteredRuleExportRule` was blanket-excluded from ever scanning its own target dir — replaced file-level exclusion with per-rule `allowSelfAnalysis` opt-in. Negative-control verified. |
| #310 | Bound remediation worker-failure retries + exclude transcript-purged candidates | Real 2026-09-01 incident: a retry storm burned the entire monthly remediation budget in 35 min; every tick since silently no-op'd for 10+ days |
| #311 | PR #310 post-merge review fixes | 3 P1 bugs fixed via new atomic `record_remediation_failure` RPC |
| #312 | Highlights transcript fallback, frozen dim count, stuck chips | User-reported 4-symptom RCA on video `gKgWYFOhZx0`: PR #281 camelCase/snake_case wire-contract regression, premature-finalize race, dishonest "100% complete" label + stale refetch guard |
| **#313** | Chat/WordCloud/Chapters connection-drop resilience (5-track RCA) | **MERGED** `2786f9d0`. See §2 — a post-merge review found 2 real P0 gaps IN this fix itself, now being fixed (see below). |

All merged PRs were independently gate-verified by CC (qa-intel:ci exit 0 un-piped, full vitest, tsc) before merge — not just trusted from agent reports.

## 2. What's OPEN right now — resume here first

### `fix/pr313-review-findings` worktree (OC dispatch, check status on resume)
`.claude/worktrees/oc-pr313-review-findings`. **PR #313 is already merged** but a post-merge review (Cubic-style) found real gaps in the resilience fix itself — CC independently verified both P0s directly against the merged code on `origin/main` before dispatching (not just trusting the review):

- **P0a**: `web/hooks/useKnowledgeGraph.ts` line ~97 — `if (res.status >= 500 && attempt < MAX_GRAPH_FETCH_RETRIES)` only retries HTTP 5xx. A raw network-level `fetch()` rejection (`TypeError: Failed to fetch` — the EXACT scenario from the original incident) never re-enters the bounded retry schedule; it only recovers via the `online` event listener.
- **P0b**: same fetch call has **no `AbortController`/timeout at all** — a stalled/never-settling request blocks forever, and the retry logic can't run because it's gated on the promise settling first. Can recreate the "stuck until reload" bug the fix was written to prevent.
- **P1a**: `lastAttemptFailed` may not reset to `false` on a successful fetch — could cause a redundant refetch on a later `online` event.
- **P1b**: `useAutoRestoreAnalysis.ts` and `useChapters.ts` may share the same two gaps — dispatch was told to check and fix if so.
- **P2**: the admin-logs snapshot regression test (CC's own addition) only checks that a fetcher's NAME appears as a substring in the route file — doesn't verify it's actually inside the `Promise.all([...])` array. Dispatch was told to tighten if worth it, not force it.

Dispatch prompt: `docs/agent-prompts/2026-09-15-oc-pr313-review-findings.md`.

**Next action**: check `ps aux | grep "opencode run"` + the worktree's git log/ledger. If `[DONE]`, independently re-verify with the EXACT CI command (`pnpm run qa-intel:ci`, not `--mode diff` — see §3.6, CC made this exact mistake twice this session already), then push/PR/merge.

### `fix/pr312-review-findings` worktree (OC dispatch, check status on resume)
`.claude/worktrees/oc-pr312-review-findings`. Post-merge review of #312:
- **P0**: parent finalization in `persist/route.ts` isn't an atomic/idempotent `processing→terminal` guard — concurrent retries could double-finalize, duplicate side effects, or overwrite a newer result with a stale one.
- **P1a**: a malformed-but-nominally-`completed` chunk could be silently dropped during the `isFullySettled` settled-partial stitch.
- **P1b**: payload-less-chunk discriminator only checks `!validPayload` — a truthy-but-malformed payload (`{}`, `{foo:'bar'}`) might still slip through.
- **P2a**: `useAuxElementStatus`'s one-shot refetch guard is set BEFORE the fetch succeeds — StrictMode/transient-failure can permanently consume it.
- **P2b**: highlights validator's `verbatimExcerpt`/`takeawayIdx` are `.optional()` — a future snake_case regression would pass validation silently again.

Dispatch prompt: `docs/agent-prompts/2026-09-15-oc-pr312-review-findings.md`. **Known file overlap risk**: this branch and the (now-merged) #313 both touch `web/app/api/analyses/persist/route.ts` — if `fix/pr313-review-findings` also lands changes there, expect a real merge conflict when both are ready; resolve by reading both diffs, don't blind-force either.

**Next action**: same as above — check completion, re-verify with the exact CI command, push/PR/merge.

---

## 3. Tooling / environment fixes made this session (durable, not per-PR)

1. **opencode dispatch pattern established**: `opencode run "<task>" -m openrouter/z-ai/glm-5.3-flash --variant low --title "<name>"`, always `nohup ... > /tmp/oc-<name>.log 2>&1 & disown` (backgrounded), always in an isolated `git worktree`, always with the dispatch prompt file physically **copied** into that worktree (it's a separate checkout — an uncommitted prompt file in the main checkout does NOT appear there). Monitor via the `Monitor` tool polling `kill -0 <pid>`.
2. **opencode needs frequent relaunches** — reliably runs out of steam mid-task (upstream 504s, permission-sandbox halts on any path outside its own worktree including `/tmp`, or just stops without finishing gate/commit/push). Always check `git log`/`git status`/ledger before assuming `[DONE]`; relaunch with `-c` and a corrective note. Happened 4-6 times per dispatch this session — budget for it.
3. **Global `npm` is broken** on this machine (pre-existing, unrelated corruption). Use **`pnpm`** for anything global (`pnpm add -g <pkg>`) — confirmed working.
4. **TypeScript LSP installed and working**: `pnpm add -g typescript-language-server typescript` (the official Anthropic `typescript-lsp` plugin was already cached but had no binary). Used successfully for fast, reliable cross-file symbol enumeration.
5. **`~/.config/opencode/opencode.json` had an invalid `lsp.disabled: false`** (blocked opencode entirely). Backed up, removed the `lsp` block. If opencode fails immediately with "Configuration is invalid" again, check this file first.
6. **qa-intel has two meaningfully different check modes** — `--mode diff --base origin/main` vs `qa-intel:ci` / `--ci --compare` (what CI actually runs). They can disagree — CC got burned by this TWICE this session (once on #313 directly, caught before merge). **Always run the exact `pnpm run qa-intel:ci` command before declaring a branch clean, never just `--mode diff`.** This is now a top-priority item for Wave A below (turn this into a structural guarantee, not a repeatedly-relearned lesson).
7. **Cloudflare Observability MCP tool has a real server-side schema bug** (`$workers.outcome` required-string but some real rows have it undefined → whole response rejected) — queued as feedback, not fixed.
8. **`gh pr checks --json` flag doesn't exist in this environment's `gh` version** — use plain `gh pr checks <n>` and grep/parse text output, not `--json`.

## 4. Standing open items (not urgent, not forgotten)

- **`NE-62S4OYCg`** (0/11 dims, failed twice identically) — root cause still NOT confirmed. Needs direct Cloudflare Worker dashboard log pull (blocked by the MCP bug above).
- **500-render-site for WordCloud** — code-only investigation exhausted, needs live reproduction or logs.
- **`jsonrepair_failed` Sentry check** — re-check once #313's telemetry fix has been live a while; 0 results currently expected (tag is new).
- Two `SendFeedback` drafts queued locally (never sent without explicit approval): Cloudflare Observability MCP schema bug, ts-morph stale-content bug (qa-intel's `SourceFile.getText()` returned different/shorter content than the real file at the same path).

## 5. Key durable facts worth not re-deriving

- Remediation budget architecture (ADR 019) + the 2026-09-01 incident + #310/#311's fix are DONE.
- `docs/private/` is git-untracked/confidential — does NOT exist in any worktree. Never ask OC to read it.
- OC's sandbox rejects ANY path outside its own worktree, including `/tmp`.
- This repo's non-required CI checks (Codacy, CodeFactor, DeepSource) fail on nearly every PR for pre-existing/informational reasons and do NOT block merge — established correct pattern. Real gates: Lint / Type Check / Unit Tests / Pipeline Status / Build.

---

## 6. TWO NEW PLANNED WAVES (user directive, 2026-09-15 08:50 EEST — NOT STARTED YET)

User's own framing, preserved closely: both waves should be dispatched to OC (GLM 5.3 flash) with CC doing orchestration/verification/audit before and after. Prompts must be **very specific**, must instruct OC to use **all available relevant skills abundantly** ("go plus select" — don't just use the minimal core set), and must **mandate negative-control tests** for every fix before it's considered done, so the result reaching CC is already maximally clean. **Before either wave starts: assess ROI/usefulness explicitly — this is a substantial effort, be selective about which fights to fight, both waves need to be smart and efficient, not exhaustive for its own sake.**

### Wave A — Mine a real Codacy issue list into new/improved qa-intel rules

User has a real Codacy-compiled issue-frequency list (pasted verbatim below) they want used to **proactively enhance qa-intel** so code matching these patterns gets caught BEFORE it ships, reducing technical debt at the source rather than fixing it after Codacy flags it post-merge (exactly the pattern that's been happening all session — Codacy/DeepSource failing on nearly every PR as a non-blocking afterthought).

**Prioritization logic requested**: some items are high-frequency but low-impact ("highly fleeting" — the user's words, likely meaning trivial/cosmetic) and should be LOW priority despite volume; others may be lower-frequency but high-blast-radius (security-shaped: SSRF, path traversal, weak RNG, insecure dependencies) and should be HIGH priority regardless of count. **Do not just sort by the count column** — triage by actual risk×frequency, and design the enumeration methodology explicitly (don't hand-wave "high/medium/low", show the reasoning per item or per cluster).

**The real pasted list** (exact counts from Codacy, this repo, as of 2026-09-15):

```
Code patterns
Disallow un-serializable expressions in Qwik $ scopes (useQwikValidLexicalScope) — 159
Enforce useExhaustiveDependencies — 23
Avoid Expression Not Assigned — 22
Enforce use of button type — 17
Avoid pass in except block — 15
Disallow implicit any on let/var declarations — 14
Avoid Using Non-Literal User Input for File System Paths — 14
Avoid Server-Side Request Forgery (SSRF) by Validating User-Controlled URLs — 14
Avoid Use of Cryptographically Weak Random Number Generators — 12
Avoid using array index as key — 12
Detect Python Source Code Errors with Pyflakes — 11
Detect Insecure Dependencies (High Severity) — 9
Enforce Iterable Callback Return Consistency — 7
EnforceUseKeyWithClickEvents — 6
Detect Insecure Dependencies (Medium Severity) — 6
Disallow interactive handlers on static elements (noStaticElementInteractions) — 6
Avoid Unreachable Code — 5
Enforce Exhaustive Dependency Lists in React Hooks — 5
Use semantic elements instead of role attributes — 4
Disallow assignments in expressions (noAssignInExpressions) — 4
Avoid Using Unsafe Dynamic Method Calls — 4
Avoid Using Non-Literal Values in RegExp Constructor — 3
Avoid Unused Variables — 2
Avoid Path Traversal via path.join or path.resolve with User Input — 2
Disallow Redeclaration (noRedeclare) — 2
Enforce SVG has accessible title or label — 2
Disallow control characters in regular expressions — 2
Enforce Pinning of Third-Party GitHub Actions to Full Commit SHA — 2
Detect Insecure Dependencies (Critical Severity) — 2
Others — 15
```

**CC's own read on this before dispatching (verify, don't just trust this pre-analysis)**:
- The Qwik rule (159 occurrences) is almost certainly a false-positive-class noise item for THIS repo — **hex-yt-intel is a Next.js/React app, not Qwik**. 159 hits on a framework this codebase doesn't use strongly suggests either (a) Codacy misdetected the stack for some files, or (b) a vendored/generated directory is being scanned that shouldn't be. Investigate this FIRST — it may not need a new qa-intel rule at all, it may need a Codacy scope/exclude fix instead, and it's dominating the count in a way that could distort prioritization if not handled separately.
- Insecure Dependencies (Critical/High/Medium, 2+9+6=17 combined) and the security-shaped rules (SSRF, path traversal, weak RNG, non-literal FS paths) are the highest-blast-radius items regardless of count — these map to OWASP Top 10 categories this repo already has a skill for (`owasp-top-10`).
- React-shape items (`useExhaustiveDependencies`, `Enforce Exhaustive Dependency Lists in React Hooks`, `array index as key`, `EnforceUseKeyWithClickEvents`) are likely duplicates/near-duplicates of each other (same underlying React hooks-deps and list-key issues reported by different tool backends) — worth consolidating into ONE qa-intel rule cluster, not several redundant ones.
- Accessibility items (button type, semantic elements vs role, SVG title/label, static-element-interactions) cluster naturally under this repo's existing `web-design-guidelines`/a11y conventions.

**Task shape for the dispatch**: for each cluster (not necessarily each individual line), determine (1) is this a real gap in qa-intel's current ruleset or already covered, (2) if real, design and implement a new qa-intel rule (or extend an existing one) following this repo's established rule-authoring conventions (`scripts/quality-engine/rules/*.ts`, the `IRule`/`Rule` interfaces, the self-analysis `allowSelfAnalysis` pattern from #309, test-file exemption patterns from #310-#313's own fixes), (3) write a regression test with a **negative control** proving the rule actually fires on a real violating fixture and doesn't false-positive on this repo's own legitimate code, (4) run the rule against the FULL codebase (`--mode full`) to gauge real current violation count before deciding if this needs its own cleanup pass or can just gate future code.

### Wave B — Audit the P2–P5 backlog since ~August 1st, build a dependency tree, propose a rollout plan

User's framing: the session has been fixing P0/P1 issues reactively for weeks, accumulating a substantial P2/P3/P4(/P5?) backlog that's never been swept. Need to:
1. Enumerate every deferred/lower-priority item logged since ~2026-08-01 (search `.memory/AGENT_LEDGER.md`, `docs/TECH_DEBT_LEDGER.md`, `.memory/ADRS.md`'s 🔍-status rows, and any PR review comments that were explicitly deferred rather than fixed — e.g. PR #310's dispatch prompt already lists several P3 items that were logged-not-fixed).
2. Classify each (still relevant? superseded by a later fix? genuinely still open?).
3. Build a real dependency tree — what blocks what, what's safe to parallelize, what has to wait.
4. Propose a rollout plan (waves/batches) based on that tree, not just a flat priority-sorted list.
5. **Assess ROI/usefulness explicitly before committing to executing any of it** — this is the user's own explicit ask, don't skip it. Some backlog items may no longer be worth doing (context changed, already mooted by a later fix, low value for the effort).

This wave is explicitly SCOPING/PLANNING first (per user: "once we did that, we should create a dependency tree... and accordingly roll out a review plan") — do not start executing fixes for Wave B items until the dependency tree + ROI assessment is reviewed with the user. Wave A's actual rule-building work can proceed once its own ROI pass says it's worth it, since the user described it more directly as "fix this."

### Dispatch mechanics for both waves (per explicit user instruction)
- Both waves go to OC (GLM 5.3 flash), CC orchestrates/verifies before and after.
- Prompts must be built from `docs/agent-prompts/TEMPLATE.md` as always, but **especially thorough on the skills section** — user explicitly said "go plus select and be extremely abundant with skills" (i.e. don't just apply the mandatory core 5, actively look for every skill that could plausibly help each specific task).
- Every fix produced must include a negative-control test before being considered complete, mirroring the pattern already established this session (e.g. #309's `allowSelfAnalysis` negative control, #313's starvation-bug negative control).
- CC must independently re-verify (real CI command, not just `--mode diff`) before merge, matching this session's established audit discipline.
