/**
 * Single source of truth (TypeScript side) for "does this analysis's
 * persisted validation_report have a description / channel meta / comments"
 * -- MUST mirror get_user_history_overview's has_description/
 * has_channel_meta/has_comments SQL logic EXACTLY (supabase/migrations/
 * 20260724100000_history_overview_function_v6_aux_status.sql): same source
 * (validation_report only, never analysis_payload or live videoMetadata/
 * title fallbacks), same truthiness rules (non-empty trimmed string /
 * non-empty object / non-empty array).
 *
 * Real bug, live-reported 2026-08-01: the History list (reading the SQL
 * function's strict truth) and useAuxElementStatus (previously falling back
 * to vm?.title / vm?.channelTitle / commentCount>0 as loose stand-ins)
 * disagreed for the SAME completed analysis -- History correctly showed
 * non-green chips, Synth Console incorrectly showed all green. Extracted to
 * one named function (was inline in the hook) so any future TypeScript-side
 * caller reuses this instead of hand-rewriting the mirror a second time --
 * SQL and TS can't literally share code, but TS callers should never
 * duplicate each other.
 */
export function auxStatusFromValidationReport(report: {
  metadata?: { description?: string };
  channelMeta?: Record<string, unknown> | null;
  comments?: unknown[] | null;
} | null | undefined): { hasDescription: boolean; hasChannelMeta: boolean; hasComments: boolean } {
  const r = report ?? {};
  const descStr = r.metadata?.description ?? '';
  const hasDescription = typeof descStr === 'string' && descStr.trim().length > 0;
  const hasChannelMeta = Boolean(
    r.channelMeta &&
    typeof r.channelMeta === 'object' &&
    !Array.isArray(r.channelMeta) &&
    Object.keys(r.channelMeta).length > 0
  );
  const hasComments = Array.isArray(r.comments) && r.comments.length > 0;

  return { hasDescription, hasChannelMeta, hasComments };
}
