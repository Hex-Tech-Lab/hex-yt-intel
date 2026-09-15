# Agent Dispatch Prompt — Remove plaintext test credentials from testsprite_tests/*.py

**Target Agent**: OC (GLM-5.3-flash, low effort)
**Effort Level**: low

> **Before dispatching**: this prompt has NOT been run through the
> `improve-prompt` skill mechanization step (time-boxed this session) —
> flagged per the template's own note rather than silently skipping it.

---

## 0. Ledger protocol — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> **Follow `AGENTS.md` §5 "SHARED COMMUNICATION PROTOCOL" in full — it is the
> canonical, authoritative version, not summarized here to avoid drift.**
> Read it now if you haven't already. In short: read `.memory/AGENT_LEDGER.md`
> AND `.memory/ADRS.md` before touching any file; post `[IN_PROGRESS]` with
> intent + target files as your first action; re-check the ledger after every
> subtask; post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what
> actually happened (not what you intended) as your last action; use the
> `[NOTE]`/`[ACK]`/`[DISPUTE]`/`[RESOLVED]` flow for cross-agent corrections.
>
> This is not optional bookkeeping: skipping it has previously caused two
> agents to collide on the same checkout with mixed uncommitted diffs
> (2026-08-03), and this exact template was created because a dispatched
> prompt omitted this instruction and the ledger post only happened after
> the user manually told the agent to follow protocol (2026-08-06).

---

## Model-tuning rule — [ALWAYS APPLY, not a section to copy-paste]

**A "flash"/low-effort-tier model does not reliably execute prose
*principles* — it executes literal, numbered, sequential *steps*.** This
task touches exactly 11 files with one repeated pattern — do all 11 the
same way, in the numbered order below, and do not skip re-verifying after
each one.

**Explicit scope boundary — read this twice**: you are NOT rewriting git
history. Do NOT run `git filter-branch`, `git filter-repo`, `bfg`, or any
force-push. The credential remains in past commits after your change — that
is a KNOWN, ACCEPTED limitation of this task, to be handled separately by
CC with the user's explicit permission (history rewrite is a destructive,
hard-to-reverse action outside your scope). Your job is only: (1) stop the
credential from being live/working, (2) stop it from existing in the
CURRENT working tree going forward.

## 1. Context & Problem Statement

A 2026-09-10 audit (`docs/PRE_LAUNCH_AUDIT_RAW_2026-09-10.md`, §"TANGENT")
found that 11 git-tracked TestSprite test scripts contain a plaintext
test-account credential (an email + password pair) committed directly in
the source:

```
TC001.py, TC002.py, TC003.py, TC004.py, TC005.py, TC006.py, TC008.py,
TC009.py, TC011.py, TC012.py, TC015.py
(all under testsprite_tests/)
```

This is a real, live credential for a test account on this product (not a
throwaway/fake value) — confirm this yourself by reading one file before
proceeding, don't assume the audit's characterization.

## 2. Contract & Implementation Directives

**Contract**: after your fix, `git grep` for the credential's email pattern
across `testsprite_tests/` must return zero literal matches in any tracked
file, AND the test scripts must still be runnable (read from an env var
instead), AND the actual test account's password must be ROTATED (changed
in whatever auth system owns it — Supabase Auth, most likely, given this
project's stack) so the now-public value in git history stops being a live
credential regardless of what's in the working tree.

Steps, in order:

1. Read `testsprite_tests/TC001.py` in full. Identify the exact variable(s)
   holding the email and password.
2. Check `testsprite_tests/tmp/config.json` — the 2026-09-10 audit noted it
   has a `loginPassword`/`loginUser` field. Determine if these test scripts
   already have an established pattern for reading credentials from config/
   env rather than inline literals (check `code_summary.yaml` and any
   `conftest.py`/shared fixture file in `testsprite_tests/` first — do not
   assume none exists).
3. If an env-var/config pattern already exists elsewhere in this project's
   Python test tooling, follow it. If not, create the minimal one: read from
   `os.environ["TESTSPRITE_TEST_ACCOUNT_EMAIL"]` / `os.environ["TESTSPRITE_TEST_ACCOUNT_PASSWORD"]`,
   failing loudly (not silently) if unset.
4. Apply the same replacement to all 11 files identically — same variable
   names, same read pattern. Do not introduce 11 slightly different
   implementations.
5. Add a `.env.example`-style note (check if `testsprite_tests/` or the repo
   root already has a `.env.example` — add to it if so, create
   `testsprite_tests/.env.example` if not) documenting the two required env
   vars, with placeholder (not real) values.
6. **Rotate the actual credential**: this is a real account on this
   product's own auth system. Find where test accounts are provisioned
   (search `docs/`, `scripts/`, or ask the ledger — do not guess the auth
   flow). If you cannot rotate it yourself (e.g., it needs Supabase Auth
   dashboard access you don't have), STOP and report this as `[BLOCKED]` —
   do not leave this step silently undone in your final report.
7. Run `git grep -c "<the email>"` (find the literal value from step 1
   before you delete it, to search for it) across the working tree — must
   return nothing once your changes are in place.

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

- **ALWAYS**: `qa-intel` (`pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare` AND `--mode full`), `code-reviewer`, `review-delta`.
- This diff touches only `testsprite_tests/**` (Python, not TS/TSX) — the
  FE/BE-specific skill branches (react-best-practices, owasp-top-10, etc.)
  do not apply. Note that explicitly in your report rather than silently
  skipping the decision tree.
- `database-sentinel` — IF step 6 (credential rotation) touches Supabase
  Auth directly; check for exposed-credential patterns in whatever you touch.

## 4a. Verification & Quality Gates (local)

```bash
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full
git grep -c "<the literal email you found in step 1>" -- testsprite_tests/
```

## 4b. External CI / Tool Stack

Not applicable — do not open a PR for this without CC's review first, since
step 6 (credential rotation) has real account-access implications. Push to
a branch (`fix/testsprite-credential-leak`) and stop; CC will review before
opening the PR.

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Additionally: explicitly state whether step 6 (rotation) succeeded, was
blocked, or was skipped — this is the single most important line in your
report, do not bury it.
