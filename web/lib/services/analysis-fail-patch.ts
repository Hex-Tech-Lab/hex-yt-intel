export interface FailPatch {
  billing_status: 'failed';
  validation_report: Record<string, unknown> & { status: 'failed'; client_reported: true; reason: string; failed_at: string };
  updated_at: string;
}

/**
 * Build the terminal-failure row patch for a client-observed stream failure
 * (pure — no I/O). Consumed by POST /api/analyses/[id]/fail. Mirrors
 * analysis-reaper.ts's buildSettlePatch convention: pure builder, unit
 * tested, applied by the caller via a guarded `.eq('billing_status',
 * 'processing')` update so it can never race a legitimate /persist
 * completion into a false failure.
 *
 * Merges into `existingReport` rather than replacing it wholesale — a
 * 'processing' row can already hold partial dimension_status/streaming
 * progress fields (same reasoning as buildSettlePatch's `...baseReport`
 * spread); overwriting the whole object would silently discard that
 * diagnostic data on every client-observed failure.
 */
export function buildFailPatch(
  reason: string | undefined,
  existingReport?: unknown,
  nowIso: string = new Date().toISOString(),
): FailPatch {
  const baseReport =
    existingReport && typeof existingReport === 'object' && !Array.isArray(existingReport)
      ? (existingReport as Record<string, unknown>)
      : {};
  return {
    billing_status: 'failed',
    validation_report: {
      ...baseReport,
      status: 'failed',
      client_reported: true,
      reason: reason || 'Client-observed stream failure',
      failed_at: nowIso,
    },
    updated_at: nowIso,
  };
}
