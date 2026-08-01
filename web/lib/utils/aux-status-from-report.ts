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
export interface AuxStatusReportInput {
  // Persisted JSON, not a type guarantee -- SQL reads this via `->>`, which
  // accepts and text-coerces any JSON scalar/object/array, not just strings.
  // Typing this as `string` would contradict jsonTextValue()'s own coercion
  // logic below and make it look like dead code (cubic review, PR #177).
  metadata?: { description?: unknown };
  channelMeta?: Record<string, unknown> | null;
  comments?: unknown[] | null;
}

export interface AuxStatusResult {
  hasDescription: boolean;
  hasChannelMeta: boolean;
  hasComments: boolean;
}

/**
 * Mirrors Postgres's `->>` text-extraction operator: a JSON string passes
 * through as-is; a scalar (number/boolean) becomes its text representation;
 * an object/array becomes its JSON text representation (e.g. `[]`, `{}`,
 * `{"a":1}`) -- NOT the empty string. `String([])` is `''` in JS, which
 * would disagree with `->>` (which yields the non-empty text `'[]'`) for a
 * description that happens to be a JSON array (cubic review, PR #177); this
 * function exists specifically so that case isn't silently wrong.
 */
function jsonTextValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

export function auxStatusFromValidationReport(report: AuxStatusReportInput | null | undefined): AuxStatusResult {
  const r = report ?? {};
  const descStr = jsonTextValue(r.metadata?.description);
  // Postgres's `trim(both from ...)` (used by the SQL SSOT) strips only the
  // ASCII space character by default -- JS's .trim() strips ALL Unicode
  // whitespace (tabs, newlines, etc.), a wider set. A description that's
  // only tabs/newlines would disagree between the two (cubic review, PR
  // #177): SQL would count it as non-empty content, JS .trim() would zero
  // it out. Matching SQL's narrower default keeps the two in lockstep.
  const hasDescription = descStr.replace(/^ +| +$/g, '').length > 0;
  const hasChannelMeta = Boolean(
    r.channelMeta &&
    typeof r.channelMeta === 'object' &&
    !Array.isArray(r.channelMeta) &&
    Object.keys(r.channelMeta).length > 0
  );
  const hasComments = Array.isArray(r.comments) && r.comments.length > 0;

  return { hasDescription, hasChannelMeta, hasComments };
}
