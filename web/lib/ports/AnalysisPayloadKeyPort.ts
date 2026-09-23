/**
 * AnalysisPayloadKeyPort — atomic top-level key merge into a row's
 * `analysis_payload` jsonb column (ADR 031, PR #322 round-2 P1 fix).
 *
 * Contract: mergePayloadKey(analysisId, key, value) must persist ONLY the
 * single named key database-side (jsonb_set), never a client-side read-
 * modify-write of the whole payload — concurrent writers (persist finalize,
 * highlights, remediation) must survive. Returns whether the row was
 * actually updated (affectedRows) so zero-row writes are visible, not
 * silently swallowed.
 */
export interface AnalysisPayloadMergeResult {
  persisted: boolean;
  affectedRows: number;
}

export interface AnalysisPayloadKeyPort {
  mergePayloadKey(analysisId: string, key: string, value: unknown): Promise<AnalysisPayloadMergeResult>;
}
