/**
 * Validation completion status (NOT billing status).
 * Reflects actual analysis output completeness.
 * - 'done': All promised dimensions delivered
 * - 'partial': Some dimensions complete, others failed/incomplete
 * - 'failed': Analysis ran but validation/core logic failed
 * - 'error': Analysis crashed or system error
 * - 'interrupted': Analysis was explicitly stopped
 * - 'processing': Analysis still running
 */
export type ValidationReportStatus = 'done' | 'partial' | 'failed' | 'error' | 'interrupted' | 'processing';

/**
 * Billing status (independent of validation status).
 * Determines whether customer is charged and quota consumed.
 *
 * RCA (2026-07-23): this type used to be 'pending' | 'chargeable' | 'charged' |
 * 'failed', but the ACTUAL database column (analyses.billing_status) has
 * enforced `CHECK (billing_status IN ('processing', 'completed', 'failed'))`
 * since migration 20260611183500 -- a constraint that has NEVER matched this
 * type. Every write of 'chargeable' has always violated that constraint
 * (confirmed live: no analysis has successfully reached a terminal billing
 * status since 2026-07-13, 10 days of silent failures). 'charged' was never
 * written anywhere in the codebase either -- no payment-collection process
 * exists that would transition chargeable->charged, so the 4-state model was
 * aspirational, not a real requirement. Collapsed to match the DB's actual,
 * battle-tested 3-state contract instead of widening the DB to match a
 * speculative type nothing implements.
 * - 'processing': Analysis in progress, not yet billable
 * - 'completed': Analysis complete, quota consumed / ready to charge
 * - 'failed': Analysis failed, no charge
 */
export type BillingStatus = 'processing' | 'completed' | 'failed';

/**
 * Per-dimension completion status.
 * Tracks which dimensions succeeded, failed, or are incomplete.
 */
export interface DimensionStatus {
  dimension: number;
  status: 'done' | 'partial' | 'failed' | 'error' | 'timeout';
  progress?: number; // 0-1 for partial completion
  error?: string;
  completedAt?: string;
}

/**
 * Persisted validation report metadata for an analysis.
 * Tracks validation completion, metadata, and per-dimension status.
 * BILLING RULE: Only charge if validation_status='done' (all dimensions complete).
 */
export interface PersistedValidationReport {
  validation_status?: ValidationReportStatus;
  billing_status?: BillingStatus;
  dimension_status?: DimensionStatus[];
  transcript_available?: boolean;
  analysis_type?: string;
  stale_after?: string;
  metadata?: any;
  // Channel-level metadata (subscriber count, channel description, etc.), fetched
  // by the worker's TranscriptExtractor.fetchChannelMetadata but previously
  // discarded after a console.info log -- now threaded through persist so chat
  // grounding can surface it instead of only the video's own metadata.
  channelMeta?: Record<string, unknown> | null;
  // Top relevance-ordered video comments (author, text, publish date, likes)
  // from the worker's MetadataScraper.fetchComments (YouTube Data API).
  comments?: Array<{ author: string; text: string; publishedAt: string; likeCount: number }> | null;
  persona?: string;
  timezone?: string;
  model_used?: string | null;
  valid?: boolean;

  // Legacy field for backward compatibility
  status?: ValidationReportStatus;
}

/**
 * Type guard: verify object is a valid PersistedValidationReport.
 * Validates status enum values and structure.
 * Accepts both legacy `status` field and new `validation_status`/`billing_status`.
 * @param obj - Object to validate
 * @returns True if object matches PersistedValidationReport shape
 */
export function isPersistedValidationReport(obj: unknown): obj is PersistedValidationReport {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }

  const validationStatus = (obj as any).validation_status;
  const legacyStatus = (obj as any).status;
  const billingStatus = (obj as any).billing_status;

  const validValidationStatuses: ValidationReportStatus[] = ['done', 'partial', 'failed', 'error', 'interrupted', 'processing'];
  const validBillingStatuses: BillingStatus[] = ['processing', 'completed', 'failed'];

  // Check new validation_status field
  if (validationStatus !== undefined && validationStatus !== null) {
    if (!validValidationStatuses.includes(validationStatus)) {
      return false;
    }
  }

  // Check legacy status field (for backward compatibility)
  if (legacyStatus !== undefined && legacyStatus !== null) {
    if (!validValidationStatuses.includes(legacyStatus)) {
      return false;
    }
  }

  // Check billing_status field
  if (billingStatus !== undefined && billingStatus !== null) {
    if (!validBillingStatuses.includes(billingStatus)) {
      return false;
    }
  }

  // Check dimension_status if present
  const dimensionStatus = (obj as any).dimension_status;
  if (dimensionStatus !== undefined && dimensionStatus !== null) {
    if (!Array.isArray(dimensionStatus)) {
      return false;
    }
    const validDimStatuses = ['done', 'partial', 'failed', 'error', 'timeout'];
    for (const dim of dimensionStatus) {
      if (!dim.dimension || typeof dim.dimension !== 'number') {
        return false;
      }
      if (!dim.status || !validDimStatuses.includes(dim.status)) {
        return false;
      }
    }
  }

  return true;
}
