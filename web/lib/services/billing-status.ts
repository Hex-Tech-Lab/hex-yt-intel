/**
 * Resolve the final billing_status for a persisted analysis row.
 *
 * Single source of truth for the "cancelled overrides content; otherwise
 * dimension-completeness decides billing" rule. Extracted from the inline
 * ternary that previously lived at two independent call sites in
 * persist/route.ts (Path 1 ~line 617 and Path 2 ~line 851), allowing both
 * to share the exact same logic and the test suite to exercise the real
 * expression rather than re-implementing it inline.
 *
 * - `cancelled=true`  -> always 'cancelled', regardless of dimensions
 * - `cancelled=false` -> billingStatus from buildDimensionStatus ('completed'
 *   or 'failed' based on dimension count); never governed by schema validation
 *   pass/fail, which only speaks to KG/persona metadata quality, not content.
 *
 * Lives in its own module (moved from stitch-analysis-chunks.ts, PR #314
 * second review round) to keep that file under the 500-line qa-intel
 * monolith-file gate; stitch-analysis-chunks re-exports it.
 */
import type { BillingStatus } from "@/lib/types/validation-report";

export const resolveBillingStatus = (
  cancelled: boolean,
  billingStatus: BillingStatus,
): BillingStatus => (cancelled ? "cancelled" : billingStatus);
