/**
 * Tiers permitted to export the FULL report (TOC + all 11 dimensions).
 * Lives in its own module because Next.js App Router route.ts files reject
 * custom named exports at build time (CodeRabbit review, 2026-09-24) --
 * the route imports from here, tests import from here, never re-export
 * from route.ts.
 *
 * 'admin' is a DB-only retention tier (not in UserTier). Light is
 * digest-only (executive summary) by product decision 2026-09-24.
 */
export const FULL_REPORT_TIERS: ReadonlySet<string> = new Set(['pro', 'max', 'enterprise', 'admin']);
