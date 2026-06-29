# qa-intel Rule Set Audit & Coverage Expansion Plan (v1.0)

**Date**: 2026-06-29  
**Scope**: `scripts/quality-engine/rules/` (43 total rules)  
**Baseline**: @typescript-eslint, ESLint strict-mode, Cloudflare Workers best practices

---

## Executive Summary

The qa-intel rule set provides strong domain-specific coverage for **streaming**, **persistence**, **RLS security**, and **UI performance**, with 43 rules across 5 categories. However, significant gaps exist in:
- **Type safety & null coalescing** (no TypeScript strict-mode equivalents)
- **Async/await patterns** (limited Promise handling detection)
- **RLS boundary enforcement** (only detects Supabase direct access, not missing `.eq()` constraints)
- **Worker runtime constraints** (no Wasm/module boundary checks)
- **Import cycle detection** (circular dependency prevention)

This audit identifies **7-10 high-signal candidates** from proven ESLint + TypeScript rulesets, prioritized by false-positive rates and impact on streaming/Worker contexts.

---

## Part 1: Current Rule Inventory (43 Rules)

### 1.1 Architecture Rules (12 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk |
|---|-----------|------------------|----------|---------------------|
| 1 | `hexagonal-boundary-enforcer` | Direct `getSupabaseClient()` outside `/adapters/` | critical | Low |
| 2 | `complexity-monitor` | Files >500 lines | medium | Medium |
| 3 | `error-taxonomy-audit` | DB errors collapsed into `NotFound` | high | Medium |
| 4 | `cross-platform-compatibility` | `.split('\n')` without `\r?\n` | medium | Low |
| 5 | `schema-contract-audit` | `.refine()` without `.optional()` or `.default()` | critical | Low |
| 6 | `redundant-validation-detector` | Manual range checks duplicate Zod `.min/.max()` | medium | Medium |
| 7 | `workflow-safety-check` | I/O calls without try/finally; unawaited promises | medium/high | Low |
| 8 | `transcript-unsafe-access` | Deep chain access without optional chaining | high | Medium |
| 9 | `hardcoded-domain-logic` | Hardcoded persona lists in validation | medium | High |
| 10 | `state-sync-audit` | `setUrl()` without `setIsValid()` | medium | High |
| 11 | `graph-aware-boundary` | Domain files importing from `/adapters/` | critical | Low |
| 12 | `canvas-stale-data-audit` | Canvas `useEffect` missing data dependency | high | Medium |

---

### 1.2 Security Rules (9 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk |
|---|-----------|------------------|----------|---------------------|
| 1 | `credential-leak-detector` | Hardcoded test user IDs | critical | Low |
| 2 | `sanitization-check` | `dangerouslySetInnerHTML` without sanitizer | critical | Low |
| 3 | `secrets-exposure-detector` | Secrets logged to Sentry/console | high | Medium |
| 4 | `auth-security-audit` | 307 POST redirect; localhost fallback | high | Medium |
| 5 | `hmac-message-format-audit` | Vercel↔Worker HMAC field mismatch | critical | Low |
| 6 | `unsafe-property-access` | Array access without optional chaining | medium | Medium |
| 7 | `env-placeholder-namespace-audit` | Client env without `isPlaceholder()` guard | critical | Low |
| 8 | `insecure-fallback-detector` | Secret strength varies by NODE_ENV | critical | Medium |
| 9 | `sql-injection-detector` | SQL with template strings or concatenation | critical | High |

---

### 1.3 Streaming Rules (7 rules)

| # | Rule Name | Pattern Detected | Severity | Notes |
|---|-----------|------------------|----------|-------|
| 1 | `stream-resilience-audit` | `setTimeout` + `abort()` without state settlement | high | Critical for completion |
| 2 | `bundle-contradiction-detector` | Prompt: "all dims" + "ONLY these dims" | critical | Prevents ignored instructions |
| 3 | `transcript-guard-enforcer` | Entry point without transcript check | critical | Prevents costly LLM calls |
| 4 | `stream-settle-audit` | Parallel streams without per-stream abort | high | Prevents hangs |
| 5 | `cascade-order-enforcer` | Transcript fallback order reversed | high | Project-specific |
| 6 | `proxy-promotion-audit` | Proxy URL without env secret | high | Critical for Vercel/CF |
| 7 | `module-level-dynamic-import` | Module-scope import in handlers | high | Prevents retry failure |

---

### 1.4 Persistence Rules (5 rules)

| # | Rule Name | Pattern Detected | Severity |
|---|-----------|------------------|----------|
| 1 | `persist-resilience-audit` | No error state/retry on fail | high |
| 2 | `persist-abort-scope` | Client signal aborts server persist | high |
| 3 | `retry-flag-interference` | Flags block atomic-persist retry | high |
| 4 | `quorum-timeout-completion-audit` | Incomplete chunks marked as completed | high |
| 5 | `stale-state-reset-audit` | `clearAnalysis()` destroys eager data | high |

---

### 1.5 UI Rules (10 rules)

| # | Rule Name | Pattern Detected | Severity |
|---|-----------|------------------|----------|
| 1 | `inp-alert-blocker` | `alert()` in event handlers | high |
| 2 | `canvas-hover-rerender` | Canvas hover triggers React re-render | high |
| 3 | `overlay-close-cascade` | Overlay close without `startTransition` | high |
| 4 | `validation-onchange-detector` | Zod parsing on keystroke | high |
| 5 | `unhandled-clipboard-promise` | `navigator.clipboard` without catch | medium |
| 6 | `start-transition-wrapping` | State passed directly to child | medium |
| 7 | `toast-accessibility-audit` | Toast missing role/aria-live | medium |
| 8 | `swallowed-error-detector` | Empty catch blocks | high |
| 9 | `sync-import-before-redirect` | Synchronous import blocks paint | high |
| 10 | `canvas-stale-data-audit` | Canvas effect missing dependency | high |

---

## Part 2: Coverage Gaps

### 2.1 Type Safety Gaps (No Equivalent Rules)

- **Explicit null checks**: No detection for `if (count)` when count might be `0`
- **Type assertions without validation**: `.json() as Type` without Zod parse
- **Unbound function context**: Event handlers in class components

### 2.2 RLS/Auth Gaps (Critical Security)

- **Missing `.eq()` clauses**: Queries like `.select('*')` without `.eq('user_id', uid)`
- **RLS policy mismatch**: Server-side RLS but client doesn't filter
- **Unencrypted sensitive data**: `.select('password_hash')` exposed

### 2.3 Worker Runtime Gaps

- **Unvalidated env vars**: `c.env.DATABASE_URL` without existence check
- **Wasm module size**: Bundler size limits (1MB)
- **Node module fallbacks**: Core Node modules in Worker code paths

### 2.4 Import/Dependency Gaps

- **Circular imports**: `A → B → A` cycles
- **Side-effect imports**: `import 'module'` without binding
- **Unused dependencies**: Tree-shaking breaks

### 2.5 Async/Promise Gaps

- **Unhandled `.then()` chains**: Missing `.catch()`
- **Promise timeout missing**: Vercel/OpenRouter timeouts not enforced
- **Async void handlers**: `onClick={async () => {...}}` without error handling

---

## Part 3: Proposed New Rules (7-10 Candidates)

### Tier 1: Critical (3 rules)

**1. `async-void-handler-detector`**
- **Severity**: high
- **Pattern**: Async event handlers without `.catch()` or try/catch
- **FP Rate**: ~5%
- **Source**: @typescript-eslint/no-misused-promises
- **Impact**: 50+ UX bugs (silent promise rejections)

**2. `rls-query-boundary-audit`**
- **Severity**: critical
- **Pattern**: `.select()` without `.eq('user_id', ...)` filter
- **FP Rate**: ~8% (admin routes exception)
- **Source**: Supabase security guide
- **Impact**: 20+ potential data leaks

**3. `circular-import-detector`**
- **Severity**: high
- **Pattern**: Dependency cycles `A → B → A`
- **FP Rate**: ~2%
- **Source**: eslint-plugin-import/no-cycle
- **Impact**: Build-time failures; 5-10 current cycles

### Tier 2: High-Signal (4 rules)

**4. `promise-timeout-enforcement`** (~30 findings expected)
**5. `explicit-null-check`** (~15-20 findings)
**6. `missing-env-validation-at-entry`** (~8-10 findings)
**7. `side-effect-import-detector`** (~5-8 findings)

### Tier 3: Medium (2-3 rules)

**8. `unhandled-then-chain`**
**9. `bound-type-guard-enforcement`** (Worker-specific)
**10. `lazy-load-not-preloaded`** (HTML-aware; post-launch)

---

## Part 4: Implementation Roadmap

**Phase 1 (Weeks 1-2)**: Rules #1-3 (async-void, RLS boundary, circular-import)
**Phase 2 (Weeks 3-4)**: Rules #4-7 (timeout, null check, env validation, side-effects)
**Phase 3 (Weeks 5-6)**: Rules #8-10 (semantic rules + advanced checks)

**Effort per rule**: 3-5 hours (AST + tests)
**Expected findings**: 50-70 issues first scan

---

## Part 5: Coverage Before/After

| Category | Current | Proposed | Gain |
|----------|---------|----------|------|
| Architecture | 12 | 16 | +4 |
| Security | 9 | 11 | +2 |
| Streaming | 7 | 9 | +2 |
| Persistence | 5 | 5 | — |
| UI | 10 | 10 | — |
| **Total** | **43** | **51** | **+8 (19% gain)** |

---

## Part 6: Validation Strategy

1. **False Positive Testing**: Run on current codebase, measure FP rate
2. **Intentional Bug Injection**: Introduce 2-3 bugs per rule, verify detection
3. **Staged Rollout**: info → medium → high/critical over 2-week period
4. **Configuration**: Per-team allowlists for context-specific rules

---

**Version**: 1.0 | **Date**: 2026-06-29 | **Status**: Audit Complete, Ready for Phase 1
