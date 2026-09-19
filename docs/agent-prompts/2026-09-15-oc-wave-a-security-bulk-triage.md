# Agent Dispatch Prompt — Wave A-security: triage + fix/suppress remaining ~40 Codacy Critical findings

**Target Agent**: OC (opencode, GLM 5.3 Flash, low effort)
**Effort Level**: low-medium (many findings, but each individually narrow; real risk is missing a genuine positive inside the noise, not complexity)

---

## 0. Ledger protocol — [ALWAYS INCLUDE]

> Read `.memory/AGENT_LEDGER.md` AND `.memory/ADRS.md` before touching any
> file; post `[IN_PROGRESS]` with intent + target files first; post
> `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary last.

---

## 1. Context & Problem Statement

The user exported their Codacy dashboard's 55 "Critical" security findings
for this repo (2026-09-15). Item 1 (2 Next.js unauthenticated-RCE CVEs) is
already fixed in PR #317 (patch-bump 16.2.11→16.3.3) — do not touch that.

CC (this session's orchestrator) personally verified 5 of the remaining
findings against real code and found them to be FALSE POSITIVES or
already-mitigated — Codacy's static rules are pattern-matching without
understanding the actual data-flow trust boundary in each case:

1. `web/components/billing/checkout-button.tsx:48` (`window.location.href =
   sessionUrl` — "open redirect" shape): `sessionUrl` comes from
   `/api/billing/checkout`'s own JSON response, which in turn comes directly
   from Paddle/Stripe's own checkout-session-creation API response
   (`result.checkoutUrl` / `res.url` in `web/app/api/billing/checkout/route.ts`)
   — never user input. FALSE POSITIVE.
2. `web/lib/services/stitch-analysis-chunks.ts:425` ("prototype pollution"):
   the surrounding function already has an explicit `FORBIDDEN_KEYS =
   ["__proto__", "constructor", "prototype"]` guard checked BEFORE both the
   read-traversal and the `delete target[key]` write — verified the guard
   covers the actual write path, not just the snippet Codacy flagged.
   FALSE POSITIVE (already mitigated).
3. `web/app/api/admin/settings/[key]/route.ts:92` (ReDoS via
   `new RegExp(validation.regex)`): the route is gated by `requireAdmin()`
   at the top (line ~28) — only authenticated admins can ever set this
   value. Residual risk is an admin causing a self-inflicted DoS, not an
   attacker. LOW-RISK, essentially false positive for THIS codebase's threat
   model — but flag with a one-line code comment rather than silently
   ignoring, in case the admin-settings surface ever gets exposed more
   broadly later.
4. `web/lib/utils/entity-time-seek.ts:179` (ReDoS via `new RegExp(escapedLabel)`):
   `escapedLabel` is built via `label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`
   immediately before use — standard regex-metacharacter escaping. FALSE
   POSITIVE — the "non-literal value" IS escaped, Codacy's rule just can't
   see that.
5. `web/components/templates/LegalPage.tsx:84` (XSS via
   `dangerouslySetInnerHTML`): the injected content is a STATIC hardcoded
   CSS template literal (`@keyframes hx-rise {...}`), not user or LLM
   content at all, and it's ALSO wrapped in `DOMPurify.sanitize()` as
   defense-in-depth on top of that. FALSE POSITIVE.

**Your job**: verify CC's 5 read above are actually correct (don't just
trust it — re-read each file yourself, this instruction exists specifically
because "report says verified" is not sufficient at this project), THEN
triage and act on the remaining ~40 findings using the SAME methodology:
check the actual data-flow trust boundary at each site, don't blanket-trust
or blanket-dismiss Codacy's label.

## 2. Contract & Implementation Directives

Work in this worktree (already checked out on `main`, clean):
`.claude/worktrees/oc-wave-a-security-backlog`, branch
`fix/wave-a-security-backlog`. This branch already has PR #317's Next.js
bump commit on it (merged separately) — your work is a SEPARATE PR on this
same branch name continuing forward, or ask CC if a fresh branch is cleaner
(default: continue on this branch, open PR #317... no wait, #317 is
already open for the Next.js fix alone — CREATE A NEW BRANCH
`fix/wave-a-security-triage` off current `main` for this work instead, to
keep the Next.js bump PR reviewable on its own).

### The remaining findings, grouped by real pattern-cluster (not Codacy's raw labels):

**Cluster 1 — Internal-API relative-path fetches flagged as "SSRF"** (~13 sites):
`useHighlightsStatus.ts:67`, `useChatStore.ts:76`, `useChatStore.ts:223`,
`useChatStore.ts:281`, `UsersAdminClient.tsx:123`, `useAuxElementStatus.ts:88`,
`useKnowledgeGraph.ts:90`, `useRelations.ts:51`, `useStreamReattach.ts:48`,
`AnalysisHistory.tsx:279`, `api-client.ts:28`, `fetchers.ts:327`,
`DubShortLinkAdapter.ts:43`, `contract-auditor.ts:412` (dev script).

**For EACH one**: confirm the URL is either (a) a relative path starting
with `/api/...` (same-origin, fixed prefix, only a path SEGMENT like an ID
is interpolated — real SSRF requires the attacker to control the ORIGIN/HOST,
not just a path segment) or (b) built from an internal constant
(`DUB_API_BASE`, an env var, a hardcoded base URL) with no user-controlled
component in the origin. If (a) or (b) confirmed for ALL of them: this
entire cluster is a false-positive class for this codebase's actual threat
model. Do NOT just assert this — spot-check the actual variable's origin at
each site (is `analysisId`/`userId`/`convId` ever, anywhere in its call
chain, attacker-suppliable as a FULL URL rather than an opaque ID string?).
If you find even ONE site where the interpolated value could plausibly
contain a full URL or a different host, STOP and flag it as a REAL finding
requiring a fix (validate/allowlist the value before use), don't lump it
into the false-positive bucket.

**Resolution for confirmed false positives**: do not just leave them
unaddressed — Codacy will keep re-flagging them every scan, which is exactly
the "non-blocking afterthought" pattern the user wants to stop. Options, in
order of preference: (1) if Codacy supports an inline suppression comment
with a required justification (check Codacy's docs/existing usage in this
repo first — grep for any existing suppression pattern), use it with a real
justification citing the actual trust boundary; (2) if no inline suppression
mechanism exists, ask CC whether a `.codacy.yml`/equivalent config-level
exclude for this specific rule+pattern is appropriate — do NOT disable the
rule repo-wide, only exclude the specific verified-safe pattern if the tool
allows path/pattern-scoped excludes.

**Cluster 2 — File-system path construction flagged as "path traversal"** (~13 sites):
`refund-policy/page.tsx:15`, `terms-and-conditions/page.tsx:15`,
`privacy-policy/page.tsx:15`, `legal/sub-processors/page.tsx:15` (4 legal
pages, same pattern), `enforce-bundle.mjs` (5 sites: lines 9,12,14,15,28),
`generate-prompt-migration.js` (5 sites: lines 5,49,50,54,59),
`contract-auditor.ts:69`.

For the 4 legal pages: confirm the file path is built from a FIXED,
compile-time-known slug/filename (not derived from a URL param, query
string, or any request input) — these are typically static legal-doc
loaders. If confirmed, false positive — document why in the same
suppression mechanism as Cluster 1.

For `enforce-bundle.mjs`, `generate-prompt-migration.js`,
`contract-auditor.ts`: these are BUILD-TIME / DEV-TIME scripts (not part of
the deployed runtime serving real users) — check they're genuinely never
invoked with request-derived input (they run via `pnpm` scripts / CI, not
as an API route). If confirmed, false positive for the actual production
attack surface, though still worth a suppression comment rather than a
silent exclude, since Codacy can't tell "build script" from "request
handler" automatically.

**Cluster 3 — `Math.random()` flagged as "weak crypto RNG"** (~12 sites):
`sentry-telemetry.ts:94,97` (cosmetic uptime jitter, explicitly commented),
`worker-llm.ts:38` + `WorkerIngestionAdapter.ts:29` (User-Agent rotation,
likely duplicated logic — flag as a `review-duplication` finding too, not
just security), `sentry.config.js:93` (Sentry sampling — check what the
`if (Math.random() > 0.5)` actually gates before assuming it's harmless
sampling), `HighlightsTransitionOverlay.tsx:36` (audio buffer noise
generation, cosmetic), `WordCloud.tsx:262` (layout angle randomization,
cosmetic), `generate-followup-prompts.ts:165,198` (picking a random prompt
template, not security), `outbox.ts:65` (message-ID generation — combined
with `Date.now()`, check if IDs are ever used for anything security-relevant
like idempotency/auth, not just display), `persist/route.ts:28` (retry-jitter
backoff factor, not security), `OpenRouterCompletionAdapter.ts:68`
(fallback digest-ID generation when `analysisId` is absent — check what
this ID is actually used for downstream).

For EACH: confirm the random value is NEVER used for a session token,
password, CSRF token, API key, auth nonce, or anything where predictability
would let an attacker forge/guess a credential or bypass a check. If
confirmed for all, false-positive-for-security-purposes (though `Math.random`
→ `crypto.randomUUID()`/`crypto.getRandomValues()` is still a reasonable
low-priority code-quality nice-to-have for ID-generation sites specifically
— note this as a P3, don't block the security triage on it).

**Cluster 4 — dynamic object-property function dispatch flagged as "command injection"** (4 sites):
`webhook-handlers.ts:350` (`eventHandlers[event.type]`),
`event-handlers.ts:84` (`EVENT_HANDLERS[event.type]`),
`DimensionDrawer.tsx:56` (`keyHandlers[e.key]`),
`ExpandedPanelOverlay.tsx:77` (`keyHandlers[e.key]`).

For each: confirm the dispatch table (`eventHandlers`/`EVENT_HANDLERS`/
`keyHandlers`) is a CLOSED, statically-defined object literal (not built
from user input, not using `eval`/`Function`/`require(dynamicPath)`) and
that the lookup key (`event.type` from a Stripe webhook payload, `e.key`
from a keyboard event) is only ever used to SELECT among the closed set of
functions, never to construct a NEW function or module path. If confirmed,
false positive — this is a standard type-safe dispatch-table pattern, not
command injection (real command injection needs code/command construction
from untrusted input, not a bounded lookup).

## Negative-control / verification requirement

For every finding you classify as false-positive, your report must include
proof-of-verification (the actual code snippet showing the trust boundary,
not just an assertion "confirmed safe"). For any finding that turns out to
be REAL (you find one), fix it properly with a real test, following this
project's usual E2E/negative-control standard — do not rush a fix just to
close out the list; a real fix on ONE genuine finding matters more than
speed-closing the whole 55.

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

Match against the LIVE skill list (`ls ~/.claude/skills .claude/skills`).
Given this task's shape:
- **ALWAYS**: `qa-intel` (both modes), `code-reviewer`, `simplify`,
  `review-delta`, `review-duplication` (explicitly relevant — Cluster 3 has
  a likely-duplicated User-Agent-rotation function), `contract-auditor`.
- **owasp-top-10** — mandatory for this entire task, it IS an OWASP-shaped
  security triage (A01 broken access control / path traversal, A10 SSRF).
- **race-condition-guard** — only if any REAL (non-false-positive) finding
  you fix touches concurrent/shared state.
- Use `build-graph`/`semantic_search_nodes_tool` (Step 0) to find every
  CALLER of any function you touch, not just the flagged line.

## 4a. Verification & Quality Gates (local)

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm dlx tsx scripts/verify-quality-engine.ts --mode full --ci
pnpm exec tsx web/scripts/contract-auditor.ts
```

## 4b. External CI

Push to a NEW branch `fix/wave-a-security-triage` (off current `main`,
which already includes PR #317's Next.js bump), open a PR, check
`gh pr checks` for real Codacy re-scan results if available before/after —
confirm your suppressions/fixes actually reduce the flagged count, don't
just assume.

---

## 5. The Three Tenets — [ALWAYS INCLUDE]

> 1. Contract definition + enforcement.
> 2. E2E cycle complete, input to output, across the ENTIRE chain.
> 3. Tangent hunt as you walk the workflow.

## 6. Report Format — [ALWAYS INCLUDE]

> RCA → Contract → Fix → E2E proof → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.

Additionally: produce a summary table (finding → verified-safe/real-bug →
action taken) so CC can spot-check a sample rather than re-verify all ~40
from scratch. Flag explicitly if you found the review-duplication issue in
Cluster 3 (worker-llm.ts vs WorkerIngestionAdapter.ts User-Agent rotation)
and whether you consolidated it or left it as a separate tangent for later.

Do NOT merge or close the PR yourself — CC verifies against real sources
(including spot-checking your "false positive" claims, not trusting them at
face value — same standard applied to every finding in this task) and merges.
