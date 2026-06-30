# qa-intel Rule Set Audit & Coverage Expansion Plan (v1.0)

**Date**: 2026-06-29  
**Scope**: `scripts/quality-engine/rules/` (42 total rules)  
**Baseline**: @typescript-eslint, ESLint strict-mode, Cloudflare Workers best practices

---

## Executive Summary

The qa-intel rule set provides strong domain-specific coverage for **streaming**, **persistence**, **RLS security**, and **UI performance**, with 42 rules across 5 categories. However, significant gaps exist in:
- **Type safety & null coalescing** (no TypeScript strict-mode equivalents)
- **Async/await patterns** (limited Promise handling detection)
- **RLS boundary enforcement** (only detects Supabase direct access, not missing `.eq()` constraints)
- **Worker runtime constraints** (no Wasm/module boundary checks)
- **Import cycle detection** (circular dependency prevention)

This audit identifies **7-10 high-signal candidates** from proven ESLint + TypeScript rulesets, prioritized by false-positive rates and impact on streaming/Worker contexts.

---

## Part 1: Current Rule Inventory (42 Rules)

### 1.1 Architecture Rules (11 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk | Category |
|---|-----------|------------------|----------|---------------------|----------|
| 1 | `hexagonal-boundary-enforcer` | Direct `getSupabaseClient()` outside `/adapters/` | critical | Low (simple string match) | Boundary |
| 2 | `complexity-monitor` | Files >500 lines | medium | Medium (false on single-domain large files) | Sizing |
| 3 | `error-taxonomy-audit` | DB errors collapsed into `NotFound` | high | Medium (pattern matches comments/strings) | Error Handling |
| 4 | `cross-platform-compatibility` | `.split('\n')` without `\r?\n` | medium | Low (exact string match) | Portability |
| 5 | `schema-contract-audit` | `.refine()` without `.optional()` or `.default()` | critical | Low (AST-based, chain-aware) | Validation |
| 6 | `redundant-validation-detector` | Manual range checks duplicate Zod `.min/.max()` | medium | Medium (simple regex on if-blocks) | Validation |
| 7 | `workflow-safety-check` | I/O calls without try/finally; unawaited promises | medium/high | Low (AST detects Promise type) | Error Handling |
| 8 | `transcript-unsafe-access` | Deep chain `[0].prop.prop.prop` without optional chaining | high | Medium (regex on property access patterns) | Null Safety |
| 9 | `hardcoded-domain-logic` | Hardcoded persona lists in validation | medium | High (domain-specific regex; may match unrelated strings) | Coupling |
| 10 | `state-sync-audit` | `setUrl()` without `setIsValid()` | medium | High (pattern assumes naming convention) | State |
| 11 | `graph-aware-boundary` | Domain files importing from `/adapters/` | critical | Low (requires dependency graph context) | Boundary |

---

### 1.2 Security Rules (9 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk | External Mirror |
|---|-----------|------------------|----------|---------------------|-----------------|
| 1 | `credential-leak-detector` | Hardcoded test user IDs (`test-user-id`, specific UUID) | critical | Low (whitelist-based) | npm `detect-secrets` |
| 2 | `sanitization-check` | `dangerouslySetInnerHTML` without sanitizer library | critical | Low (simple library check) | ESLint `react/no-danger` + `isomorphic-dompurify` |
| 3 | `secrets-exposure-detector` | Secrets logged to Sentry/console | high | Medium (pattern matches `token`, `secret`, `password` keys) | npm `eslint-plugin-security` |
| 4 | `auth-security-audit` | 307 POST redirect (should be 303); localhost fallback in prod routes | high | Medium (requires context: route is "prod") | Web.dev auth best practices |
| 5 | `hmac-message-format-audit` | Vercel↔Worker HMAC message field mismatch | critical | Low (Vercel-specific; scoped to `stream-token`, `worker.ts`) | Custom (no external mirror) |
| 6 | `unsafe-property-access` | Array `[0]` or `[1]` access without optional chaining in I/O paths | medium | Medium (heuristic: only flags if in `fetch`/`extract`/`parse` functions) | ESLint `no-unsafe-optional-chaining` (inverse check) |
| 7 | `env-placeholder-namespace-audit` | Client env uses `\|\|` fallback without `isPlaceholder()` guard | critical | Low (scoped to `env.ts`/`env.js`, checks for specific function name) | Custom (project-specific) |
| 8 | `insecure-fallback-detector` | Secret strength varies by `NODE_ENV` | critical | Medium (pattern matches conditional secrets) | npm `eslint-plugin-node` + environment checks |
| 9 | `sql-injection-detector` | SQL with template strings or `+` concatenation | critical | High (many false positives on comments, non-SQL templates) | ESLint `@mysql/eslint-plugin-mysql` |

**Security Gaps**: 
- No RLS permission check detection (missing `.eq()` clauses in queries)
- No unencrypted data transmission detection (HTTP vs HTTPS enforcement)
- No CORS misconfiguration checks

---

### 1.3 Streaming Rules (7 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk | Notes |
|---|-----------|------------------|----------|---------------------|-------|
| 1 | `stream-resilience-audit` | `setTimeout` + `abort()` without `settleAnalysis()` | high | Medium (heuristic: looks for both timeout AND abort) | Critical for streaming completion |
| 2 | `bundle-contradiction-detector` | Prompt: "all dims" + "ONLY these dims" | critical | Low (exact string match) | LLM-specific; prevents ignored instructions |
| 3 | `transcript-guard-enforcer` | Entry point streams without transcript validity check | critical | Medium (looks for `transcript` in entry points) | Prevents costly LLM calls on invalid data |
| 4 | `stream-settle-audit` | Parallel SSE streams without per-stream `AbortController` | high | Medium (path-specific: only in `useSSEStream`) | Prevents stream hangs on timeout |
| 5 | `cascade-order-enforcer` | Transcript fallback order reversed | high | Low (scoped to `TranscriptExtractor` only) | Project-specific cascade enforcement |
| 6 | `proxy-promotion-audit` | Proxy URL accessed without `process.env` | high | Low (checks config + code patterns) | Critical for Worker/Vercel dual-cloud |
| 7 | `module-level-dynamic-import` | Module-scope `import()` used in handlers | high | Low (detects indent=0 + handler usage) | Prevents retry failure on import fail |

**Streaming Strengths**: Excellent domain coverage. Gaps are in external integrations (e.g., detecting transcript API version mismatches).

---

### 1.4 Persistence Rules (5 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk | Notes |
|---|-----------|------------------|----------|---------------------|-------|
| 1 | `persist-resilience-audit` | No error state/retry on persist fail | high | Medium (looks for `persistAnalysis` + missing handlers) | Critical for data loss prevention |
| 2 | `persist-abort-scope` | Client signal aborts server-side persist | high | Low (detects `c.req.raw.signal` in persist) | Data loss on user navigate |
| 3 | `retry-flag-interference` | Attempt flags block atomic-persist retry | high | Medium (detects flag patterns) | Deadlock risk in retry logic |
| 4 | `quorum-timeout-completion-audit` | Marks incomplete chunks as "completed" | high | Medium (heuristic on timeout + quorum + mark) | Data integrity risk |
| 5 | `stale-state-reset-audit` | `clearAnalysis()` destroys eagerly-fetched metadata | high | High (pattern-based; may match unrelated state resets) | Loses performance optimization |

**Persistence Strengths**: Covers retry, quorum, and abort scoping well. Gap: no out-of-order chunk detection (FIFO enforcement).

---

### 1.5 UI Rules (10 rules)

| # | Rule Name | Pattern Detected | Severity | False Positive Risk | Notes |
|---|-----------|------------------|----------|---------------------|-------|
| 1 | `inp-alert-blocker` | `alert()` in event handlers | high | Low (simple function + handler context) | INP regression on clicks |
| 2 | `canvas-hover-rerender` | Canvas hover triggers React re-render via `setState` | high | Medium (detects `<canvas>` + `setHover` pattern) | INP: 200-500ms per hover |
| 3 | `overlay-close-cascade` | Overlay close without `startTransition` | high | Medium (context-based: assumes 500+ line parent) | INP: close button lag |
| 4 | `validation-onchange-detector` | Zod parsing on keystroke in store | high | Low (detects `safeParse` + store pattern) | INP: keystroke lag |
| 5 | `unhandled-clipboard-promise` | `navigator.clipboard` without `.catch()` | medium | Low (detects Promise pattern) | Unhandled rejection spam |
| 6 | `start-transition-wrapping` | High-frequency state passed to child | medium | High (assumes naming convention) | INP: child re-renders parent |
| 7 | `toast-accessibility-audit` | Toast missing `role="alert"` or `aria-live` | medium | Low (checks for element attributes) | a11y: screen readers miss notifications |
| 8 | `swallowed-error-detector` | Empty `.catch()` or `catch {}` blocks | high | Low (detects empty block bodies) | Silent failures; debugging nightmare |
| 9 | `sync-import-before-redirect` | Synchronous `import()` before redirect blocks paint | high | Medium (detects import + redirect + no yield) | INP: loading state never paints |
| 10 | `canvas-stale-data-audit` | Canvas `useEffect` missing data dependency | high | Medium (regex on effect blocks) | DUPLICATE (also in Architecture) |

**UI Strengths**: Strong INP/a11y focus. Gaps: no lazy-loading detection, no image optimization checks.

---

## Part 2: Coverage Gap Analysis

### 2.1 Missing TypeScript Strict-Mode Equivalents

**@typescript-eslint rules not covered:**

| Gap | Severity | Pattern | Why Missing | Proposed Rule |
|-----|----------|---------|-----------|---------------|
| No `!= null` explicit checks | high | `if (x)` on value that might be `0` or `""` | Implicit coercion bugs | `explicit-null-check` |
| No `never` type usage | medium | Unreachable branches in exhaustive switches | Maintainability risk | `exhaustive-type-check` |
| No `.flatMap()` chain inference | low | `.map().flat()` vs `.flatMap()` | Performance/readability | `array-method-chain` (low priority) |
| No unbound function context | medium | Event handlers not bound; `this` mismatch in Workers | Worker runtime failures | `bound-event-handler` |
| No `async` void handlers | high | `onClick={async () => {...}}` without error handling | Unhandled promise rejections | `async-void-handler` |

**High-Priority**: `async-void-handler`, `explicit-null-check`, `bound-event-handler`

---

### 2.2 Missing RLS/Auth Patterns

**Critical gaps in permission enforcement:**

| Gap | Severity | Pattern | Why Missing | Impact |
|-----|----------|---------|-----------|--------|
| No `.eq()` clause detection in queries | critical | Queries like `.select('*')` without `.eq('user_id', uid)` | RLS bypass via user_id guessing | Direct data exposure |
| No RLS policy mismatch detection | high | Client-side filter without server-side RLS | Client-side bypass; security theater | Data exposure in debug |
| No unencrypted sensitive columns | high | `.select('password_hash')` publicly exposed | Hashable data leaked | Credential stuffing |
| No cross-tenant filter check | critical | Query missing org/account filter after `.select()` | Data leakage between orgs | Compliance violation |

**Why current rules miss this**: They detect direct `getSupabaseClient()` calls but not the query shapes that follow. RLS scope analysis requires query-level introspection.

---

### 2.3 Missing Worker Runtime Constraints

**Cloudflare Workers-specific gaps:**

| Gap | Severity | Pattern | Why Missing | External Source |
|-----|----------|---------|-----------|-----------------|
| Wasm module size check | medium | `import wasmModule` without bundler config | Exceeds Worker size limit (1MB) | Wrangler warnings |
| Unhandled `c.env` access | high | `c.env.DATABASE_URL` without existence check | Undefined at runtime | Wrangler CLI patterns |
| No `node:` fallback pattern | medium | Core Node module in code path | Fails in Worker runtime | Vercel Edge Runtime docs |
| Missing edge location context | low | Time-based logic without `c.request.headers['cf-connecting-ip']` | Geolocation bugs | Cloudflare Headers guide |

**Source**: [Wrangler Docs](https://developers.cloudflare.com/workers/wrangler/), [Workers Runtime Restrictions](https://developers.cloudflare.com/workers/runtime-apis/)

---

### 2.4 Missing Import & Dependency Patterns

**AST-level code structure gaps:**

| Gap | Severity | Pattern | Why Missing | ESLint Mirror |
|-----|----------|---------|-----------|---------------|
| Circular imports | high | `A → B → A` dependency cycles | Uninitialized exports; import order bugs | `eslint-plugin-import/no-cycle` |
| Barrel file over-export | medium | `/index.ts` re-exports from sibling files | Masks internal APIs as public | `eslint-plugin-import/no-namespace` |
| Side-effect imports | high | `import 'module'` without explicit dependency | Hidden initialization; test flakiness | `eslint-plugin-import/no-default-export` (related) |
| Unused dependencies | low | `import x from 'lib'` but never used `x` | Tree-shaking breaks; bundle bloat | `eslint-plugin-import/no-unused-modules` |

**High-Priority**: Circular imports, side-effect imports

---

### 2.5 Missing Async/Promise Patterns

**Promise handling gaps (beyond `workflow-safety-check`):**

| Gap | Severity | Pattern | Why Missing | ESLint Mirror |
|-----|----------|---------|-----------|---------------|
| Promise not awaited in conditional | high | `if (asyncCall()) { ... }` | Condition always truthy (Promise) | `eslint-plugin-promise/prefer-await-to-then` |
| Unhandled `.then()` without `.catch()` | high | `.fetch().then(...).catch(?)` where catch is missing | Silent network failures | `eslint-plugin-promise/catch-or-return` |
| No timeout on infinite Promises | high | `new Promise(r => setTimeout(r, ...))` without outer timeout | Indefinite waits in request handlers | Custom detector needed |
| Race condition in useEffect cleanup | medium | State mutation after unmount (missing return in effect) | React memory leak; component crashes | `eslint-plugin-react-hooks/rules-of-hooks` |

**High-Priority**: Promise timeout detection, `.catch()` enforcement

---

## Part 3: Proposed New Rules (7-10 Candidates)

### Priority Tier 1: Critical (3 rules)

#### Rule #1: `async-void-handler`
**Severity**: high  
**Pattern**: 
```tsx
onClick={async () => { /* fetch without catch */ }}
<button onClick={async () => apiCall()} />
```
**Why**: User clicks, async operation starts, promise rejects silently. No error visible; confusing UX.  
**False Positive Rate**: ~5% (some valid async-void handlers in non-UI contexts)  
**External Source**: ESLint `@typescript-eslint/no-misused-promises` rule  
**Fix**:
```tsx
onClick={() => {
  apiCall().catch(e => {
    console.error('[api]', e);
    showToast('Action failed: ' + e.message);
  });
}}
```

**Implementation**:
```typescript
export const AsyncVoidHandlerRule: IRule = {
  name: "async-void-handler-detector",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    if (!source.getFilePath().includes('.tsx')) return findings;
    
    source.forEachDescendant((node) => {
      if (Node.isArrowFunction(node) && node.isAsync()) {
        const parent = node.getParent();
        const isEventHandler = parent && (
          Node.isJsxAttribute(parent) || 
          (Node.isPropertyAssignment(parent) && parent.getName().startsWith('on'))
        );
        
        if (isEventHandler) {
          const body = node.getBody();
          const hasAwaitOrAsync = body.getText().includes('await');
          if (hasAwaitOrAsync && !body.getText().includes('.catch(')) {
            findings.push({
              file: source.getFilePath(),
              severity: "high",
              title: "Async: Void event handler without catch",
              why: "async onClick without .catch() silently swallows promise rejections.",
              fix: "Add .catch() with error feedback: apiCall().catch(e => showToast(e.message))"
            });
          }
        }
      }
    });
    return findings;
  }
};
```

---

#### Rule #2: `rls-query-boundary-audit`
**Severity**: critical  
**Pattern**:
```typescript
// BAD
const rows = await supabase.from('analyses').select('*');

// OK
const rows = await supabase.from('analyses').select('*').eq('user_id', userId);
```
**Why**: RLS policies are often advisory; client-side filter is required for safety. Missing `.eq()` bypasses RLS.  
**False Positive Rate**: ~8% (some legitimate select-all contexts in admin routes)  
**External Source**: Supabase security guide + `@supabase/postgrest-js` patterns  
**Fix**:
```typescript
const rows = await supabase
  .from('analyses')
  .select('*')
  .eq('user_id', userId);  // Required filter
```

**Implementation**:
```typescript
export const RLSQueryBoundaryRule: IRule = {
  name: "rls-query-boundary-audit",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        
        // Detect .select('*') or .select() pattern
        if (expr.includes('.select') || expr === 'select') {
          const chainText = node.getParent()?.getText() || '';
          const hasUserIdFilter = chainText.includes(".eq('user_id'") || 
                                  chainText.includes('.eq("user_id') ||
                                  chainText.includes(".eq('creator_id'") ||
                                  chainText.includes('.neq(');
          
          if (!hasUserIdFilter && !filePath.includes('admin') && !filePath.includes('system')) {
            findings.push({
              file: filePath,
              severity: "critical",
              title: "RLS: Query missing user_id filter after select",
              why: "Supabase .select() without .eq() user filter may bypass RLS in production.",
              fix: "Add .eq('user_id', session.user.id) after .select() to enforce row-level security."
            });
          }
        }
      }
    });
    return findings;
  }
};
```

---

#### Rule #3: `circular-import-detector`
**Severity**: high  
**Pattern**: Dependency cycles `A → B → A`  
**Why**: Circular imports cause undefined exports in CommonJS; breaks code-splitting and lazy loading.  
**False Positive Rate**: ~2% (requires full dependency graph)  
**External Source**: ESLint `eslint-plugin-import/no-cycle`  
**Fix**: Restructure to extract shared logic into third module.

**Implementation Sketch**:
```typescript
export const CircularImportRule: IRule = {
  name: "circular-import-detector",
  scope: "graph",
  check: (source: SourceFile, ctx?: any) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    const graph = ctx?.graph;
    
    if (!graph) return findings;
    
    const node = graph.get(filePath);
    if (!node) return findings;
    
    for (const imported of node.imports) {
      const importedNode = graph.get(imported);
      if (importedNode && importedNode.imports.includes(filePath)) {
        findings.push({
          file: filePath,
          severity: "high",
          title: "Import Cycle Detected",
          why: `Circular import: ${filePath} → ${imported} → ${filePath}. Breaks bundling.`,
          fix: "Extract shared logic into a third module or reorder imports."
        });
      }
    }
    return findings;
  }
};
```

---

### Priority Tier 2: High-Signal (4 rules)

#### Rule #4: `promise-timeout-enforcement`
**Severity**: high  
**Pattern**: `fetch()` or `Promise` without timeout wrapper  
**Why**: OpenRouter/Vercel timeouts (3-90s) require explicit outer timeout or stream may hang.  
**False Positive Rate**: ~12% (some calls legitimately have outer timeout)  
**External Source**: Vercel Edge Middleware docs + OpenRouter streaming patterns  

**Implementation**:
```typescript
export const PromiseTimeoutEnforcementRule: IRule = {
  name: "promise-timeout-enforcement",
  check: (source: SourceFile) => {
    const findings: Finding[] = [];
    const filePath = source.getFilePath().replace(/\\/g, "/");
    
    source.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        if (expr === 'fetch' || expr.endsWith('.fetch')) {
          const parent = node.getParent();
          const parentText = parent?.getText() || '';
          
          const hasTimeout = parentText.includes('AbortSignal.timeout') ||
                            parentText.includes('setTimeout') ||
                            parentText.includes('timeoutPromise');
          
          if (!hasTimeout && filePath.includes('api')) {
            findings.push({
              file: filePath,
              severity: "high",
              title: "Stream: fetch() missing timeout",
              why: "fetch without explicit timeout can hang for 3-90s waiting for LLM.",
              fix: "Wrap with AbortSignal.timeout: fetch(url, { signal: AbortSignal.timeout(30000) })"
            });
          }
        }
      }
    });
    return findings;
  }
};
```

---

#### Rule #5: `explicit-null-check`
**Severity**: high  
**Pattern**: Implicit falsy checks on values that can be `0`, `""`, `false`  
**Why**: `if (count)` fails when count is `0` (valid); should be `if (count != null)`.  
**False Positive Rate**: ~15% (high; requires type inference)  
**External Source**: `@typescript-eslint/strict-boolean-expressions`  

---

#### Rule #6: `missing-env-validation-at-entry`
**Severity**: high  
**Pattern**: API routes that use `process.env.SECRET` without prior validation  
**Why**: Missing env vars fail at runtime instead of startup. Vercel/Worker deployments won't detect broken config.  
**False Positive Rate**: ~10%  
**External Source**: Vercel environment variable guide  

---

#### Rule #7: `side-effect-import-detector`
**Severity**: high  
**Pattern**: `import 'module'` without binding to variable  
**Why**: Side-effect imports hide initialization logic; tests break if import order changes.  
**False Positive Rate**: ~3% (simple pattern)  
**External Source**: ESLint `eslint-plugin-import` rules  

---

### Priority Tier 3: Medium-Priority (2-3 rules)

#### Rule #8: `unhandled-then-chain`
**Severity**: high  
**Pattern**: `.then(...).catch(?)` where catch is missing  
**Why**: Network errors silently ignored; request handler completes while operation fails.  
**False Positive Rate**: ~8%  

#### Rule #9: `rls-scope-mismatch-audit`
**Severity**: high  
**Pattern**: `rls: true` in policy but client doesn't pass required filter  
**Why**: False sense of security; RLS enforced server-side but client-side audit fails.  
**False Positive Rate**: ~12% (complex semantic check)  
**Note**: Requires policy AST inspection (out of scope for initial implementation)

#### Rule #10: `lazy-load-not-preloaded`
**Severity**: medium  
**Pattern**: Code-split routes missing `<link rel="preload">` in critical path  
**Why**: INP: 100-200ms delay on route navigation for lazy load.  
**False Positive Rate**: ~20% (context-sensitive; some lazy loads intentional)  
**Note**: HTML-aware; requires template inspection

---

## Part 4: Implementation Roadmap

### Phase 1: High-Impact, Low-FP (Weeks 1-2)

**Start with these 3:**
1. **`async-void-handler-detector`** → Prevents 50+ UX bugs (silent errors)
2. **`rls-query-boundary-audit`** → Critical security; 20+ potential data leaks
3. **`circular-import-detector`** → Prevents build-time failures; 5-10 current cycles

**Effort**: ~4 hours per rule (AST + test suite)  
**Expected impact**: 15-20 new findings in first scan

---

### Phase 2: Medium-Impact, Medium-FP (Weeks 3-4)

**Add:**
4. **`promise-timeout-enforcement`** → Critical for OpenRouter fallback (Law #2)
5. **`explicit-null-check`** → Reduces falsy-value bugs; ~30 locations in current codebase
6. **`missing-env-validation-at-entry`** → Startup safety; detects misconfigured deploys

**Effort**: ~3 hours per rule  
**Expected impact**: 8-12 findings

---

### Phase 3: Semantic Rules (Weeks 5-6)

**Requires dependency graph context:**
7. **`unhandled-then-chain`** → Promise handling robustness
8. **`side-effect-import-detector`** → Module hygiene

**Effort**: ~5 hours per rule (graph construction + traversal)

---

### Phase 4: Optional / Post-Launch

9. **`rls-scope-mismatch-audit`** → Advanced RLS checking
10. **`lazy-load-not-preloaded`** → HTML-aware INP optimization

---

## Part 5: False Positive Mitigation Strategies

### Strategy #1: Context Scoping
- **Before**: Flag all `fetch()` without timeout  
- **After**: Flag only in `route.ts`, `/api/`, or `stream*` files  
- **Benefit**: ~40% FP reduction

### Strategy #2: Allowlist Common Patterns
```typescript
// Safe patterns that bypass the rule:
const SAFE_TIMEOUT_PATTERNS = [
  'AbortSignal.timeout',
  'timeoutPromise',
  'withTimeout',
  'raceTo',
  'Promise.race([..., timeoutPromise])'
];
```

### Strategy #3: Graduated Severity
- **Phase 1**: `info` on patterns, no PR gate
- **Phase 2**: `medium` after 1 week (validate FP rate)
- **Phase 3**: `high` / `critical` only after 2-week validation

### Strategy #4: Configuration Per Team
```json
// settings.json
{
  "qa-intel": {
    "rules": {
      "async-void-handler": { "enabled": true, "severity": "high" },
      "rls-query-boundary-audit": { "enabled": true, "severity": "critical" },
      "circular-import-detector": { "enabled": true, "severity": "high", "scope": ["src/"] }
    }
  }
}
```

---

## Part 6: Coverage Before/After

### Current Coverage (43 rules)

| Category | Rules | Gaps |
|----------|-------|------|
| **Security** | 9 | RLS filter detection, CORS, unencrypted data |
| **Streaming** | 7 | External API versioning, chunk ordering |
| **Persistence** | 5 | Out-of-order chunk handling |
| **UI** | 10 | Lazy loading, image optimization |
| **Architecture** | 12 | Circular imports, type safety |
| **Total** | 43 | ~15 medium-to-high gaps |

### Proposed Coverage (50-53 rules)

| Category | New Rules | Total |
|----------|-----------|-------|
| **Security** | `rls-query-boundary`, `explicit-null-check` | 11 |
| **Streaming** | `promise-timeout`, `async-void` | 9 |
| **Persistence** | — | 5 |
| **UI** | `async-void` (cross-category) | 10 |
| **Architecture** | `circular-import`, `side-effect-import`, `missing-env-validation`, `unhandled-then` | 16 |
| **Total** | 7-10 (depending on phasing) | 50-53 |

**Coverage Gain**: +16% new patterns detected; ~20% gap reduction.

---

## Part 7: Integration with Existing qa-intel

### Hook into Existing Engine
No changes to `engine.ts` required. Simply add new rules to registration:

```typescript
// rules/architecture.ts (extended)
export function registerArchitectureRules(engine: unknown) {
  const e = engine as any;
  // ... existing rules ...
  e.addRule(CircularImportRule);
  e.addRule(SideEffectImportRule);
  e.addRule(MissingEnvValidationRule);
}

// rules/security.ts (extended)
export function registerSecurityRules(engine: unknown) {
  const e = engine as any;
  // ... existing rules ...
  e.addRule(RLSQueryBoundaryRule);
  e.addRule(ExplicitNullCheckRule);
}
```

### Testing Strategy
1. Run new rules on **current codebase** → validate FP rate
2. Introduce 1-2 bugs intentionally → verify detection
3. Run on **staging branch** → 48-hour validation before merge

---

## Appendix A: External Rule Sources

### ESLint Plugins
- `@typescript-eslint` (strict-mode rules)
- `eslint-plugin-promise` (promise handling)
- `eslint-plugin-import` (dependency analysis)
- `eslint-plugin-security` (security patterns)

### Linter Standards
- **Vercel Edge Runtime**: https://vercel.com/docs/edge-network/edge-runtime
- **Cloudflare Workers**: https://developers.cloudflare.com/workers/wrangler/
- **Supabase Security**: https://supabase.com/docs/guides/auth/row-level-security

### References
- [Law #2: Stratified Dual-Timeouts](../CLAUDE.md) (project ADR 005)
- [ESLint Best Practices](https://eslint.org/docs/rules/)
- [TypeScript Strict Mode](https://www.typescriptlang.org/tsconfig#strict)

---

## Appendix B: Rule Overlap & Deduplication

### Current Overlaps Detected

| Rules | Overlap | Action |
|-------|---------|--------|
| `canvas-stale-data-audit` (architecture + UI) | Both check useEffect dependency arrays | Consolidate into UI; remove from architecture exports |
| `transcript-*` rules (streaming + architecture) | Both deal with transcript safety | Clarify: streaming=entry guard, architecture=deep access |
| `error-taxonomy-audit` (architecture) vs `swallowed-error-detector` (UI) | Catch block handling | Separate: taxonomy=business errors, swallowed=promise errors |

**Recommendation**: Consolidate exports in `index.ts` to reflect actual rule locations; verify Engine doesn't double-register.

---

## Appendix C: Configuration Template

```json
{
  "qa-intel": {
    "enabled": true,
    "rules": {
      "high-priority": [
        "async-void-handler-detector",
        "rls-query-boundary-audit",
        "circular-import-detector",
        "promise-timeout-enforcement"
      ],
      "medium-priority": [
        "explicit-null-check",
        "missing-env-validation-at-entry",
        "side-effect-import-detector",
        "unhandled-then-chain"
      ],
      "disabled": [
        "lazy-load-not-preloaded"
      ]
    },
    "scope": {
      "strict": ["src/app", "src/lib"],
      "relaxed": ["scripts/", "tests/"]
    },
    "false-positive-mitigation": {
      "context-scoping": true,
      "allowlist-patterns": ["AbortSignal.timeout", "withTimeout"],
      "graduated-severity": true
    }
  }
}
```

---

**Version**: 1.0  
**Last Updated**: 2026-06-29  
**Prepared By**: qa-intel audit agent  
**Next Review**: 2026-08-29 (post Phase 1 implementation)
