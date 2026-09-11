# Agent Dispatch Prompt — Pre-launch checklist §1-§8 real-status audit

**Target Agent**: OC (GLM-5.3-flash, low effort)
**Effort Level**: low

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

---

## Model-tuning rule — [ALWAYS APPLY]

This is a pure fact-finding task: **do not make any judgment calls, do not
decide what's "launch-blocking," do not edit the checklist file itself.**
Your job is to answer a fixed list of yes/no/evidence questions about the
CURRENT real state of the repo/PRs/DB, one at a time, in order, and write
the answers to a NEW file (below). CC will read your answers and do the
synthesis/judgment/checklist-editing separately. If you find yourself about
to write "this seems done" or "probably fine" — stop, that's a judgment
call, not a fact. Report only what you directly observed (a file's content,
a `gh pr view` result, a `git log` line, a DB query result) with the exact
command/query you ran, not an inference.

---

## 1. Context & Problem Statement

`docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md` is a live-tracking document for
hex-yt-intel's launch, last substantively updated 2026-08-19 (~3.5 weeks
stale as of today, 2026-09-10). The user has since: taken annual leave,
returned 2026-09-06, changed the launch structure to include a ~1 week
pre-launch founder-signup period, and confirmed the product is **not yet
live** (a prior assumption to the contrary was wrong and has been
corrected). Many items marked ⬜/🔵/🟡 in the document may have actually
progressed, regressed, or become irrelevant since 08-19, and nobody has
gone back to verify which.

You are NOT deciding what changed or what to do about it — you are
gathering ground-truth evidence for each item below so CC can do that
synthesis accurately instead of guessing from a stale document.

## 2. Contract & Implementation Directives

Read `docs/PRE_LAUNCH_CHECKLIST_2026-08-16.md` in full first (don't skip
§9, added today, for context on what "real audit" means in this repo's
convention). Then, for EACH numbered item below, run the exact
command/check named and record the raw result — no summarizing, no
opinion:

1. **§1.1/1.2 (PR #239 taxonomy fix)**: `gh pr view 239 --json state,mergedAt,mergeCommit` — is it merged? When?
2. **§2 (Paddle payments)**: `git log --all --oneline -- web/lib/paddle.ts web/lib/billing-factory.ts | head -20` — any commits since 2026-08-19? Also check `web/lib/paddle.ts` for whether it still points at a sandbox key or references a live one (do not print the key itself, just note sandbox vs. live vs. unclear).
3. **§2c (Simple/Pro mode split)**: grep the codebase for `useConsoleViewStore` or `ViewModeToggle` — does it exist and look wired into the dashboard? (This looks likely already shipped per `.memory/AGENT_LEDGER.md`'s 2026-08-26 entries — confirm, don't assume.)
4. **§3.1/3.2 (waitlist page)**: is there a live route at `web/app/waitlist/page.tsx`? Does it still exist and look functionally complete (form, submit handler)?
5. **§5 (GDPR footnote)**: search `web/app/` for any Terms & Conditions / privacy page — does it mention data retention, Supabase/Cloudflare/OpenRouter, or GDPR at all?
6. **§6.3 (bug triage issues #241/#242/#243)**: `gh issue view 241`, `gh issue view 242`, `gh issue view 243` — still open? Closed? When?
7. **§6b (load/duration stress tests)**: search `.memory/AGENT_LEDGER.md` and `docs/` for any mention of a 5-hour video test or 50-concurrent-user test having actually run since 08-19.
8. **§7 (TestSprite/pairwise)**: has TestSprite run again since the 2026-08-19 run described in the checklist? Check `testsprite_tests/` directory contents and modification dates.
9. **New, not in the old checklist**: does `web/app/founders/page.tsx` exist, and does a live founder pre-sale checkout/conversion mechanism exist anywhere (search for `founder` + `checkout` or `paddle` in the same file/directory)? The checklist's §1b.6 says this was NOT built as of 08-19 — confirm current state.
10. **New**: is there any marketing/teaser asset (image, video script, social copy draft) anywhere in the repo (`docs/`, `web/public/`) dated after 2026-08-19?

## 3. Pre-PR Review Skills Decision Tree

Not applicable — this task produces a findings document, not a code change. Do not open a PR.

## 4. Output

Write your findings to `docs/PRE_LAUNCH_AUDIT_RAW_2026-09-10.md`, one section
per numbered item above, each with: the exact command run, its raw output
(trimmed if long, but not paraphrased), and nothing else. No recommendations,
no status verdicts, no checklist edits.

## 5. The Three Tenets — [ALWAYS INCLUDE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

(For this task: the "contract" is the 10-item list above, verbatim — do not
add or drop items. If you find a genuine tangent — e.g. item 3 doesn't exist
at all — report that as a fact under that item, don't go investigate why.)

## 6. Report Format — [ALWAYS INCLUDE]

Post to the ledger: `[IN_PROGRESS]` when starting, `[DONE]` with the output
file path when finished. CC will read `docs/PRE_LAUNCH_AUDIT_RAW_2026-09-10.md`
directly — your ledger post just needs to confirm it exists and which of
the 10 items you completed vs. couldn't answer (e.g. no `gh` auth).
