# THOS 2026-09-19 11:40 EEST — Round-2 merges (#314–#319), OC config root-cause, Wave A/B status

## Session continuity note
Covers everything since `THOS_2026-09-15_0835_MERGE_MARATHON_PR309_TO_313_AND_TOOLING.md` (its §2 "open right now" items are **both closed** — see §1). State at write time: `main` @ `313a4c51`, **0 open PRs**, working tree has 3 uncommitted `.claude/*` deletions + 3 untracked files (§5). **RESUME HERE** for anything after 2026-09-19.

Sources: git log/`git show --stat`, `gh pr view`, `.memory/AGENT_LEDGER.md` (lines ~1394–1399). Where a claim is from the ledger only and not re-checked against code in this pass, it is marked *(ledger)*.

---

## 1. What merged since the last THOS

| PR | Merged (commit) | Diff | What it is |
|---|---|---|---|
| #316 | 09-15 11:33 (`291e91d8`) | 52 files, +4101/−60 | Removed hardcoded testsprite test-account credential from 11 tracked `TC*.py` scripts + 3 THOS docs; scripts now read `TESTSPRITE_TEST_ACCOUNT_EMAIL`/`_PASSWORD` from `os.environ` and fail at import if unset; `testsprite_tests/.env.example` added. Password rotated out-of-band 2026-09-10 via direct `auth.users` UPDATE *(ledger)*. Cubic caught 2 follow-ups fixed in-PR (a new doc re-leaked the email; `.env.example` said "copy into .env.local" but scripts have no dotenv loader → now "export in your shell"). The bulk of the line count is docs swept in (AUDIT_2026-09-05 reports, ADR_029 proposal, older agent prompts), not code. **The old credential is still in git history — no history rewrite is recorded anywhere; rotation is the mitigation.** |
| #314 | 09-19 08:40 (`fd641385`) | 21 files, +2209/−98 | Round-2 fixes on PR #312's review. `persist/route.ts` (+333): atomic/CAS parent finalize (concurrent `markChunkFailed` can no longer demote a valid payload), primitive-JSON-payload crash in settled-stitch fixed, malformed-but-"completed" chunks classified as terminal-failed, log misclassification fixed. New `side-effect-outbox.ts`, `has-usable-dimensions-payload.ts`, port/adapter additions, `useAuxElementStatus` one-shot-guard fix, highlights validator tightened, `.deepsource.toml` adjusted. 6 new/extended persist test files incl. negative controls. |
| #315 | 09-19 08:45 (`94bf0856`) | 14 files, +1896/−285 | Round-2 fixes on PR #313's review (the connection-drop resilience fix). New `web/lib/utils/fetch-with-timeout.ts` (timeout now covers **body consumption**, not just headers — the exact stuck-until-reload bug), unified retry budget in `useKnowledgeGraph`, timeout propagated to `useAutoRestoreAnalysis` + `useChapters`, malformed/empty-200 no longer leaves KG loading stuck, permanent 4xx no longer re-arms the online-retry listener, stale-flag reset. CC found a broken var-rename OC left (real `tsc` errors) and fixed it *(ledger)*. |
| #317 | 09-19 08:50 (`9fac1671`) | 10 files, +470/−94 | **Wave A-security item 1**: `next` 16.2.11 → **16.3.3** (Codacy's two unauthenticated-RCE CVEs). Side effects handled: (a) 16.3.x + Vercel + Turbopack needs `output: 'standalone'` **off** on Vercel or `onBuildComplete` ENOENTs on `next-server.js.nft.json` → new `web/lib/config/next-output-mode.ts` (`DEPLOY_TARGET` primary, `VERCEL` fallback, warns when ambiguous) + unit tests; (b) `eslint-config-next`/`@next/eslint-plugin-next` deliberately **pinned 14.2.16** in `pnpm-workspace.yaml` (ESLint 8.57.1 + legacy `.eslintrc.json`; ≥15 needs ESLint 9 flat config) with `web/package.json` specifier aligned + a guard test `next-dependency-guards.test.ts`; (c) Playwright spec + 1px fixture for image-optimization security. CC removed 2 junk Next-generated files OC committed *(ledger)*. **Not re-verified here:** that 16.3.3 is ≥ both CVEs' fixed-in versions, or that Codacy's dashboard now shows them closed. |
| #318 | 09-19 08:55 (`bae91c21`) | 8 files, +434/−15 | Closes the hallucinated-named-expert gap in Dimension 2.3/4.2. New `web/lib/prompts/credibility-grounding.ts` (+test), `factory.ts` + `ucis-v5.3.ts` changes, worker-side `prompt-builder-grounding.test.ts` (test only — `PromptBuilder.ts` itself not in the diff), `vitest.config.ts` include tweak. Round-2: grounding rule applied across all prompt-resolution paths, 4.2 authority-transfer narrowed, no-invention guard extended to titles/roles/credentials, machine-checkable post-generation validation, `MoBr0nQtOnA` fixture. CC caught a wrong import path that silently returned `undefined`, a debug scratch file, 2 qa-intel false positives *(ledger)*. **Also folded in:** live product bug where Dim 8.4 "Discovery Pathways" was silently omitted from every analysis (asked for external knowledge, contradicting the prompt's transcript-absolutism directive, no fallback) *(ledger — I did not locate the specific hunk in this pass)*. |
| #319 | 09-19 08:23 (`35c3f772`) | 1 file, +74/−12 | User-requested copy button in `DimensionDrawer.tsx` header. 3 real Cubic findings fixed: stale-confirmation race across dimension switches, static a11y label, silently-swallowed clipboard rejection *(ledger)*. |

**CI reality on these (informational, per the standing rule):** Codacy `ACTION_REQUIRED` on #314/#315/#318/#319; CodeFactor `FAILURE` on #314; DeepSource/Codacy non-blocking per project convention. Real gates (Lint/Type Check/Unit Tests/Build/Pipeline Status) were green; CC re-ran tsc/vitest/lint/qa-intel full+diff/contract-auditor per PR instead of trusting OC reports.

### Config commits on main (not PRs)
- `58a8b0de` — `.opencode/opencode.json` corrected `glm-5.2`/Baidu → `glm-5.3-flash`/relace.
- `a08d138f` — pinned glm-5.3-flash, low-effort, relace-only (global + local).
- Ledger-only commits: `cb7d0d08` (dispatch PR314/315 round-2), `f562b848` (mark BLOCKED on credits), `4d7ac0c1` (close #316), `56bad442` (dispatch round-2 for 314/315/317/318), `313a4c51` (close all 5).

---

## 2. Incident: OC silently running the wrong model since 2026-08-25
- **Symptom**: OpenRouter audit showed 213 requests / $4.33 on `z-ai/glm-5.2` against the OC dispatch key; a live dispatch printed `> build - z-ai/glm-5.2`.
- **Root cause**: project-local `.opencode/opencode.json` was pinned to glm-5.2/Baidu (introduced in `a953674b`, swept into unrelated PR #267 review-findings commit, not a deliberate change). **A project-local `.opencode/` config overrides the global `~/.config/opencode/opencode.json`** for every OC run with this repo as cwd — i.e. every dispatch.
- **Why it kept recurring**: an earlier session fixed only the working-tree copy (backup `.opencode/opencode.json.bak-2026-09-16`) and never committed it, so every `git worktree add` re-inherited the broken config from git.
- **Fix**: committed (`58a8b0de`, `a08d138f`) and propagated to all existing worktrees. **Rule going forward: after any OC config change, commit it — worktrees copy from git, not from your working tree; and check the `> build - <model>` banner on the first dispatch.**
- Earlier blocker (09-15 14:10): OC dispatches for #314/#315 died on OpenRouter "requires more credits". Evidently resolved (OC ran again 09-18); the WIP commit `6f55cc05` on the #315 branch was superseded by the merged version.

## 3. Process lessons from this stretch (durable)
1. **OC self-reports were wrong in 3 of 4 round-2 PRs** (#315 broken rename, #317 junk files, #318 bad import + scratch file). CC's independent gate re-run caught all of them. Keep doing it; don't downgrade to "OC said green".
2. **Squash-merging one PR shifts `main` under the rest** — the 5-PR sequence needed 3 rounds of re-merging main into remaining branches. Standing user preference: **merge main in, never rebase**.
3. `qa-intel:ci` vs `--mode diff` disagreement (from the last THOS §3.6) still applies; #318 hit 2 qa-intel false positives that CC had to resolve.
4. Cubic reviews continue to find real defects in "clean" PRs (#316 dangling ledger cross-reference, #319 three findings) — worth waiting for its final pass before merge.
5. OC on GLM flash still needs relaunches; permission sandbox still rejects paths outside its worktree (from last THOS §3.2 — not re-tested here).

---

## 4. Wave status (the three items from last THOS §6)

| Wave | Status | Evidence |
|---|---|---|
| **A-security** (55 Codacy findings) | **1 of 5 sub-items done.** Item 1 (Next.js RCE CVEs) shipped in #317. Items 2–5 **not started**: `CheckoutButtonProps` open-redirect-shaped finding (was due ~4 days after 09-15 → **likely past its Codacy SLA now**), `dangerouslySetInnerHTML` ×2 (one was already 2 months overdue), File-Access/SSRF/weak-RNG clusters (~37), command-injection/prototype-pollution. | Ledger: "only the Next.js CVE patch-bump shipped from that wave." |
| **A** (qa-intel rules from Codacy frequency list) | **Prompt written, never dispatched.** | `docs/agent-prompts/2026-09-15-oc-wave-a-qaintel-rules.md` (205 lines, **untracked**). Branch `chore/wave-a-qaintel-rules` = `cb7d0d08`, an ancestor of `main` (0 unique commits); its worktree dir is gone/prunable. |
| **A-security bulk triage** | **Prompt written, never dispatched.** | `docs/agent-prompts/2026-09-15-oc-wave-a-security-bulk-triage.md` (240 lines, **untracked**; targets "~40 remaining Critical"). Read its §2 branch instructions before dispatch — it references `fix/wave-a-security-backlog`, which #317 already used and merged. |
| **B** (P2–P5 backlog tree + ROI) | **Not started.** Branch `docs/wave-b-backlog-scoping` = `cb7d0d08`, 0 unique commits, worktree gone. No prompt file exists for it. | git |

The user's standing directives for these waves (ROI assessment before executing, abundant skills in prompts, mandatory negative controls, Wave B = scoping only until reviewed) are unchanged — see last THOS §6.

**Suggested resume order (proposal, confirm with user):** (1) `CheckoutButtonProps` finding — billing-adjacent, tight scope, CC-reviewed, deadline likely blown; (2) `dangerouslySetInnerHTML` ×2 — check whether content is LLM/user-influenced; (3) commit the two Wave A prompt files (they're currently only on disk) and decide dispatch; (4) reconcile File-Access/SSRF/RNG with Wave A into one rule-design pass; (5) Wave B scoping. Before any of it, pull **current** counts from Codacy directly — the 55/frequency numbers are from a 09-15 UI paste and #317 has changed them.

---

## 5. Working-tree / repo state at write time (not cleaned up — flagging only)
- **Uncommitted deletions**: `.claude/MEMORY.md` (−51), `.claude/SECURITY.md` (−100), `.claude/settings.json` (−45). Cause not identified in this session; they were already present in the session-start git status. `.claude/settings.json` is a tracked file (last touched by `7d68c41c`, the code-review-graph install). **Decide deliberately** — `git restore .claude/` if unintended; don't commit them by accident.
- **Untracked**: the two Wave A prompt files above, and `crash_output.txt` (written 09-19 10:22, contents: `Error: Input must be provided either through stdin or as a prompt argument when using --print` — a `--print`-mode CLI call with no prompt; originator unknown). Safe to delete.
- **Hygiene, not urgent**: 164 local branches; 21 worktrees listed `prunable` (dirs already gone) → `git worktree prune` is safe. Two live non-prunable worktrees exist: `.kilo/worktrees/auditor` (`auditor`) and `~/projects/web-agy1-worktree` (`fix/upgrade-modal-positioning-and-entitlement-gate`) — check before touching.
- `.memory/AGENT_LEDGER.md` was appended with this doc's `[IN_PROGRESS]`→`[DONE]` entry; not committed.

## 6. Carried over from last THOS §4, NOT touched in this period (no ledger record either way — treat as still open, unverified)
- `NE-62S4OYCg` (0/11 dims, failed twice, root cause unconfirmed; needs Cloudflare Worker log pull, blocked by the CF Observability MCP schema bug).
- WordCloud 500-render-site (needs live repro/logs).
- `jsonrepair_failed` Sentry re-check now that #313's telemetry has been live ~4 days.
- Two queued `SendFeedback` drafts (CF Observability MCP schema bug; ts-morph stale-content bug) — never sent without approval.
- ADR 021 Phases 2–3 were audited/merged per `THOS_2026-09-09_1802…`; Phase 4 (selective client dispatch) scoping — no activity recorded since.
- Standing facts unchanged: `docs/private/` absent in worktrees; OC sandbox rejects paths outside its worktree; Codacy/CodeFactor/DeepSource are non-blocking.

## Addendum (2026-09-19, post-crash follow-up)

- The three `.claude/` deletions listed above were a side effect of the WSL crash / session-file cleanup, not intentional. `.claude/MEMORY.md`, `SECURITY.md`, `settings.json` were restored from HEAD; `MEMORY.md` gained rows for PR #316 and #317. Any uncommitted pre-crash edits to them are unrecoverable (no session transcripts or file-history survive).
- code-review-graph was non-functional since 2026-08-25, independent of the crash: commit `a953674b` (PR #267 review fix) emptied `mcpServers` in `.mcp.json`, dropping the `code-review-graph` entry (TestSprite was later added to the empty file). The binary was also missing from PATH. Fixed by re-adding the `.mcp.json` entry, `uv tool install code-review-graph` (2.3.9), and a full graph rebuild (949 files, 6,317 nodes, 59,801 edges). The MCP tools only appear in sessions started after this change.
