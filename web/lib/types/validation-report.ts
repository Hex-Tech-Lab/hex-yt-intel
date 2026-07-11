export type ValidationReportStatus = 'done' | 'partial' | 'failed' | 'error' | 'processing';

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

export function isPersistedValidationReport(obj: unknown): obj is PersistedValidationReport {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const status = (obj as any).status;
  if (status !== undefined && status !== null) {
    const validStatuses: ValidationReportStatus[] = ['done', 'partial', 'failed', 'processing'];
    if (!validStatuses.includes(status)) {
      return false;
    }
  }

  return true;
}
