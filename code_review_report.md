# Code Review Report — P0 Bugs + Dead Code Purpose Audit

**Date**: 2026-05-14  
**Scope**: P0 correctness bugs + dead code git/docs verification  
**Reviewer**: /code-reviewer skill  

---

## BUG-1 · CRITICAL — Spurious Sentry Events per Breadcrumb

**File**: `web/lib/monitoring/sentry-utils.ts:18`

```ts
// CURRENT (broken)
export function addBreadcrumb(...): void {
  Sentry.captureMessage(message, 'info');   // ← fires a full Sentry event
  Sentry.addBreadcrumb({ ... });            // ← then adds the breadcrumb
}
```

**Impact**: Every call to `addBreadcrumb()` fires TWO Sentry operations: a full captured event + a breadcrumb. `analyses/route.ts` calls `addBreadcrumb` 12+ times per request. Each analysis creation generates 12+ spurious Sentry events, inflating event quota, polluting the issue tracker, and masking real errors.

**Same pattern at line 293** (`captureMetric` also calls `Sentry.captureMessage` before adding a breadcrumb).

**Fix**:
```ts
// CORRECT — breadcrumbs are context attached to the NEXT event, not events themselves
export function addBreadcrumb(
  message: string,
  data?: Record<string, unknown>,
  category = 'operation'
): void {
  Sentry.addBreadcrumb({
    message,
    category,
    level: 'info',
    data,
    timestamp: Date.now() / 1000,
  });
}
```

Remove `Sentry.captureMessage(message, 'info')` on line 18. Remove `Sentry.captureMessage(...)` on line 293 in `captureMetric` for the same reason.

---

## BUG-2 · SECURITY — Admin Stats Endpoint Has No Role Check

**File**: `web/app/api/admin/stats/route.ts:35-37`

```ts
// TODO: Add role check - verify user is admin
// For now, allow any authenticated user
const userId = (session.user as any).id;
```

**Impact**: Any authenticated user (including free-tier users) can call `GET /api/admin/stats` and receive aggregate data: total user counts, pro/free split, error rates, revenue figures, retention metrics. This is a business intelligence leak — a free user can enumerate platform growth metrics.

Additionally, line 40-43 uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (not service role). The anon key is RLS-restricted — `analyses`, `users`, `usage_logs` counts are scoped to the caller's own data via RLS. The stats returned would be **per-user counts, not platform-wide totals**, meaning the endpoint is both insecure AND returning incorrect data (the admin would see their own counts, not all users' counts).

**Fixes** (choose one, in order of preference):

**Fix A — Email allowlist from env var (immediate, no schema change):**
```ts
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim());
const userEmail = session.user?.email || '';
if (!ADMIN_EMAILS.includes(userEmail)) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
// Also switch to service role key for correct cross-user counts
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // ← not anon key
);
```

**Fix B — Role column on users table:**
Add `role: 'admin' | 'user'` to users table, check `session.user.role === 'admin'` (requires migration + NextAuth session callback update).

**Fix C — Disable endpoint until RBAC is built:**
```ts
return NextResponse.json({ error: 'Not available' }, { status: 503 });
```

**Recommended: Fix A** — unblocks immediate security gap with zero schema changes.

---

## BUG-3 · CORRECTNESS — Webhook JSDoc References Wrong Stripe Event

**File**: `web/app/api/stripe/webhook/route.ts:24`

```ts
// JSDoc says:
* - invoice.paid: Invoice paid

// Handler actually processes:
case 'invoice.payment_succeeded':  // line 81
```

`invoice.paid` and `invoice.payment_succeeded` are different Stripe events. `invoice.paid` fires when an invoice is marked paid (including manual payments and test mode). `invoice.payment_succeeded` fires when Stripe successfully charges a payment method. Both exist in Stripe's event taxonomy and have different semantics.

**Impact**: Low runtime impact (JSDoc only), but creates a maintenance hazard. A developer adding Stripe webhook handling based on the comment would register the wrong event type in Stripe's dashboard and miss payment confirmations.

**Fix**:
```ts
// web/app/api/stripe/webhook/route.ts lines 20-26
/**
 * Handles:
 * - customer.subscription.created: New subscription
 * - customer.subscription.updated: Subscription modified
 * - customer.subscription.deleted: Subscription canceled
 * - payment_intent.succeeded: Payment successful
 * - payment_intent.payment_failed: Payment failed
 * - invoice.payment_succeeded: Invoice charge succeeded  ← fix this line
 * - invoice.payment_failed: Invoice payment failed
 */
```

---

## DEAD CODE PURPOSE AUDIT

Per the protocol: check git blame + CLAUDE.md before recommending deletion.

### `lib/monitoring/metrics.ts` (234 lines)
- **Created by**: `71c0013` (chore: CI/CD pipeline fixes — not a feature commit)
- **Purpose in CLAUDE.md**: No explicit mention. Phase 2-4 roadmap does not reference custom in-process metrics. Sentry handles all observability per the current architecture.
- **Verdict**: ❌ **Safe to delete.** Created as scaffolding during CI/CD fixes, never imported by any route or component. Sentry (`sentry-utils.ts`) is the designated monitoring layer. No planned feature depends on this module.

### `lib/auth/providers/supabase.ts` + `lib/auth/providers/vercel.ts` (throw on every method)
- **Created by**: `a9007d2` (Chunk 4.5: Auth Abstraction Layer — "modular provider-agnostic architecture")
- **Purpose in CLAUDE.md**: Phase 4 "SSO + audit logs" — a provider-switching interface would support Supabase Auth or Vercel Auth as alternatives to NextAuth for enterprise plans.
- **Verdict**: ⚠️ **Keep the interface + factory, delete only the stub implementations.** The `AuthProvider` interface and `provider-factory.ts` represent a valid planned abstraction (Phase 4 enterprise). The stub files (`supabase.ts`, `vercel.ts`) that throw `'not yet implemented'` on every method add no value. **Decision**: Delete `providers/supabase.ts` and `providers/vercel.ts`. Keep `provider-factory.ts` and `lib/auth/types.ts`. Add a comment to the factory pointing to Phase 4.

### `lib/auth/provider-factory.ts` + `lib/auth.ts`
- `provider-factory.ts`: instantiates the two stub providers — with the stubs deleted, the factory becomes a one-liner that always returns `NextAuthProvider`. Simplify to direct import rather than a factory. **Safe to collapse.**
- `lib/auth.ts`: barrel that re-exports `authProvider` from the factory. With the factory simplified, this barrel serves no purpose. **Safe to delete.**

---

## SECONDARY FINDINGS (from scope expansion)

### `web/app/api/admin/stats/route.ts:40-43` — Wrong Supabase key
Uses `NEXT_PUBLIC_SUPABASE_ANON_KEY` (RLS-restricted) instead of `SUPABASE_SERVICE_ROLE_KEY`. The endpoint is intended to return platform-wide aggregates, but RLS means it returns the admin user's own data only. **Must fix alongside BUG-2.**

### `web/lib/monitoring/sentry-utils.ts:310-324` — `startTransaction` is a no-op
```ts
export function startTransaction(name: string, op: string): void {
  Sentry.startSpan({ name, op }, () => {
    // Transaction started - caller should execute code within the callback
  });
}
```
The span executes an empty callback immediately and discards the result. Any caller expecting a transaction handle gets nothing. This is dead-by-design scaffolding that should be removed to prevent future misuse.
