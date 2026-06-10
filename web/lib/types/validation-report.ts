export interface PersistedValidationReport {
  status?: string;
  transcript_available?: boolean;
  analysis_type?: string;
  stale_after?: string;
  metadata?: any;
  persona?: string;
  timezone?: string;
  model_used?: string | null;
  valid?: boolean;
}
