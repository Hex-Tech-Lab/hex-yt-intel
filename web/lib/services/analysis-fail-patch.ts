export interface FailPatch {
  billing_status: 'failed';
  validation_report: { status: 'failed'; client_reported: true; reason: string; failed_at: string };
  updated_at: string;
}

/**
 * Build the terminal-failure row patch for a client-observed stream failure
 * (pure — no I/O). Consumed by POST /api/analyses/[id]/fail. Mirrors
 * analysis-reaper.ts's buildSettlePatch convention: pure builder, unit
 * tested, applied by the caller via a guarded `.eq('billing_status',
 * 'processing')` update so it can never race a legitimate /persist
 * completion into a false failure.
 */
export function buildFailPatch(reason: string | undefined, nowIso: string = new Date().toISOString()): FailPatch {
  return {
    billing_status: 'failed',
    validation_report: { status: 'failed', client_reported: true, reason: reason || 'Client-observed stream failure', failed_at: nowIso },
    updated_at: nowIso,
  };
}
