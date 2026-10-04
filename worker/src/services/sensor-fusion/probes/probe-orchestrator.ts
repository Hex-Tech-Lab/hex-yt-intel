import * as Sentry from '@sentry/cloudflare';

/**
 * QStash probe-job handler (ADR 039 §1.2).
 *
 * R2 deletion is gated on durable job state, never on `finally`: the object is
 * the retry input, so it may only be deleted after this worker's own
 * `succeeded` transition commits against the current generation and lease.
 * Any other outcome leaves the object for the retry or the bucket's 24-hour
 * lifecycle TTL.
 */

export interface ProbeJobPayload {
  videoId: string;
  videoUrl: string;
  timestamps: number[];
}

export interface ProbeMetadata {
  visual_ui_detected: boolean;
}

export type ProbeJobStatus = 'processing' | 'retry_wait' | 'succeeded' | 'failed';

export interface ProbeJobState {
  job_id: string;
  state: ProbeJobStatus;
  generation: number;
  lease_token: string;
}

/**
 * Durable job-state port. Implementations MUST make `transition` an atomic
 * compare-and-set on (job_id, generation, lease_token), e.g. one conditional
 * UPDATE ... WHERE generation = $1 AND lease_token = $2.
 */
export interface ProbeJobStore {
  /** Claims the job with a fresh lease; null when another worker holds it or it already finished. */
  acquire(jobId: string): Promise<ProbeJobState | null>;
  /** Moves `expected` to `next`; null when the stored generation or lease no longer matches. */
  transition(
    expected: ProbeJobState,
    next: { state: ProbeJobStatus; generation: number },
  ): Promise<ProbeJobState | null>;
}

export interface ProbeDeps {
  store: ProbeJobStore;
  bucket: Pick<R2Bucket, 'delete'>;
  processAv: (payload: ProbeJobPayload, objectKey: string) => Promise<ProbeMetadata>;
  /** Receives the lease so adapters can fence writes from a superseded generation. */
  writeMetadata: (videoId: string, metadata: ProbeMetadata, lease: ProbeJobState) => Promise<void>;
}

export type ProbeJobOutcome = 'succeeded' | 'skipped' | 'stale_lease' | 'failed';

/** Thrown by A/V or DB steps for transient failures; the job moves to `retry_wait` and is retried. */
export class ProbeRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeRetryableError';
  }
}

/** Mock A/V step: replace with the real extraction + analysis stage. */
export const mockProcessAv: ProbeDeps['processAv'] = () => Promise.resolve({ visual_ui_detected: false });

/** R2 object key under which a video's probe extract is stored. */
export const probeObjectKey = (videoId: string): string => `probes/${videoId}`;

/** Durable job id for a video's probe job. */
export const probeJobId = (videoId: string): string => `probe:${videoId}`;

/** Deletes the extract after a committed success; a delete failure never changes the job outcome. */
const earlyGc = async (bucket: ProbeDeps['bucket'], videoId: string, objectKey: string): Promise<void> => {
  try {
    await bucket.delete(objectKey);
  } catch (error) {
    Sentry.captureException(error, { tags: { operation: 'probe-early-gc' }, extra: { videoId, objectKey } });
  }
};

/**
 * Runs one probe job. Retryable failures move the job to `retry_wait`
 * (generation + 1), keep the R2 object and rethrow so QStash redelivers.
 * Other failures move it to `failed` and also keep the object for the TTL.
 */
export const handleProbeJob = async (payload: ProbeJobPayload, deps: ProbeDeps): Promise<ProbeJobOutcome> => {
  const objectKey = probeObjectKey(payload.videoId);
  const lease = await deps.store.acquire(probeJobId(payload.videoId));
  if (!lease) return 'skipped';

  try {
    const metadata = await deps.processAv(payload, objectKey);
    await deps.writeMetadata(payload.videoId, metadata, lease);
  } catch (error) {
    const retryable = error instanceof ProbeRetryableError;
    const moved = await deps.store.transition(lease, {
      state: retryable ? 'retry_wait' : 'failed',
      generation: retryable ? lease.generation + 1 : lease.generation,
    });
    if (!moved) return 'stale_lease';
    if (retryable) throw error;
    Sentry.captureException(error, { tags: { operation: 'probe-job-failed' }, extra: { videoId: payload.videoId } });
    return 'failed';
  }

  const committed = await deps.store.transition(lease, { state: 'succeeded', generation: lease.generation });
  if (!committed) return 'stale_lease';
  await earlyGc(deps.bucket, payload.videoId, objectKey);
  return 'succeeded';
};
