/**
 * Analysis completion status values.
 * - 'done': Analysis complete with all dimensions
 * - 'partial': Incomplete analysis with some dimensions available
 * - 'failed': Analysis ran but validation failed
 * - 'error': Analysis crashed or encountered an error
 * - 'interrupted': Analysis was explicitly interrupted
 * - 'processing': Analysis still running
 */
export type ValidationReportStatus = 'done' | 'partial' | 'failed' | 'error' | 'interrupted' | 'processing';

/**
 * Persisted validation report metadata for an analysis.
 * Tracks analysis completion status, metadata, and execution details.
 */
export interface PersistedValidationReport {
  status?: ValidationReportStatus;
  transcript_available?: boolean;
  analysis_type?: string;
  stale_after?: string;
  metadata?: any;
  persona?: string;
  timezone?: string;
  model_used?: string | null;
  valid?: boolean;
}

/**
 * Type guard: verify object is a valid PersistedValidationReport.
 * Validates status enum values and structure.
 * @param obj - Object to validate
 * @returns True if object matches PersistedValidationReport shape
 */
export function isPersistedValidationReport(obj: unknown): obj is PersistedValidationReport {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const status = (obj as any).status;
  if (status !== undefined && status !== null) {
    const validStatuses: ValidationReportStatus[] = ['done', 'partial', 'failed', 'error', 'interrupted', 'processing'];
    if (!validStatuses.includes(status)) {
      return false;
    }
  }

  return true;
}
