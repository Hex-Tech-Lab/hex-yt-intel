# Agent Dispatch Prompt — <TASK_NAME>

**Target Agent**: <AGY-1 (Flash) (OpenCode) (Pro) AGY-2 OC |>
**Effort Level**: <high | medium | low>

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

## 1. Context & Problem Statement

<Context>

---

## 2. Contract & Implementation Directives

<Directives>

---

## 3. Pre-PR Review Skills Decision Tree (MANDATORY GATE)

> **ENFORCEMENT**: Match touched files against the tree below. Execute ALL matching skills before CI/PR. Document findings under `### Skills Run + Findings`.

- **ALWAYS (All PRs)**:
  - `/simplify`: Prune AST dead code, strip unused imports/bindings.
  - `review-delta`: Verify clean git diff (no logs, no transient scratch files).
  - `review-duplication`: Scan AST clones to block CodeFactor regressions.
  - `code-reviewer`: Adversarial check against invariants & contract gaps.

- **IF `web/components/**` | `web/hooks/**` | `web/app/**` (FE / UI)**:
  - `/react-best-practices`: Hook deps, stale closures, SSR hydration, layout stability.
  - `fe-state-auditor`: Enforce browser singletons (GoTrueClient), audit Zustand store lifecycle.
  - `accessibility-a11y`: WCAG compliance, keyboard focus traps, ARIA parity.
  - `bundle-analyzer`: Dynamic import boundaries (`next/dynamic`), CSS injection overhead.

- **IF `worker/**` | `web/app/api/**` | `*ports*` | `*adapters*` (BE / API)**:
  - `contract-auditor`: Strict Zod `safeParse`, retain typed `.data`, flag raw pass-throughs.
  - `api-route-guard`: Response status contracts (200 on empty vs 4xx/5xx) to stop retry storms.
  - `worker-port-adapter-audit`: Hexagonal isolation (zero direct infra dependencies in domain).
  - `idempotency-check`: Webhook/queue deduplication keys, replay attack tolerance.

- **IF `*billing*` | `*Paddle*` | `middleware/**` | `auth/**` (Security / Billing)**:
  - `/owasp-top-10`: Parameter injection, broken access control, CORS, input sanitization.
  - `sentry-privacy-auditor`: Redact PII, tokens, and raw payloads in Sentry `extra`.
  - `webhook-signature-verifier`: Constant-time signatures (`timingSafeEqual`), replay skew guards.
  - `secret-scanner`: Zero hardcoded credentials, JWT-like string literals, or dummy secrets.

- **IF `*stitch*` | `*synthesis*` | `*relations-engine*` | `*prompts*` (KG / Pipeline)**:
  - `build-graph`: Topological sorting, DAG integrity, prune dangling edges.
  - `entity-canonicalizer`: Case-insensitive POLE+O mapping & legacy type retention.
  - `transcript-pipeline-audit`: Strict numeric timestamps, nearest-match epsilon selection.
  - `prompt-boundary-guard`: LLM JSON parse tolerance, streaming safety, token budget limits.

- **IF `scripts/**` | `.memory/**` | `*.config.*` | `.*ignore` (Monorepo / CI)**:
  - `qa-intel`: Run `pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare`.
  - `monorepo-path-linter`: Root glob anchoring (`/*.js`) & monorepo ignore scoping.
  - `ledger-protocol-auditor`: Enforce valid `[IN_PROGRESS]` -> `[DONE]` state transitions.

---

## 4. Verification & Quality Gates

```bash
pnpm --filter @hex-yt-intel/web exec tsc --noEmit
pnpm --filter youtube-intelligence-worker exec tsc --noEmit -p tsconfig.typecheck.json
pnpm --filter @hex-yt-intel/web exec vitest run
pnpm --filter @hex-yt-intel/web lint
pnpm dlx tsx scripts/verify-quality-engine.ts --ci --compare
pnpm exec tsx web/scripts/contract-auditor.ts
```

---

## 5. The Three Tenets — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> 1. **Contract definition + enforcement.** State the exact input→output
> contract for what you're building BEFORE writing it.
> 2. **E2E cycle complete, input to output, across the ENTIRE chain.**
> 3. **Tangent hunt as you walk the workflow.**

---

## 6. Report Format — [ALWAYS INCLUDE — DO NOT PARAPHRASE OR SUMMARIZE]

> RCA → Contract → Fix → E2E proof (with actual test output) → Tangents found → Deviations flagged → Skills Run + Findings → Gates → Files changed.
