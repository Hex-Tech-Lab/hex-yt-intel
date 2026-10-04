import * as Sentry from '@sentry/cloudflare';

/**
 * QStash probe-job handler skeleton (ADR 039 §1.2).
 *
 * A/V processing and the DB write are injected so the A/V step stays a mock
 * until the yt-dlp/ffmpeg stage lands. The R2 object is deleted in `finally`
 * (early GC) ahead of the bucket's 24-hour lifecycle TTL.
 */

export interface ProbeJobPayload {
  videoId: string;
  videoUrl: string;
  timestamps: number[];
}

export interface ProbeMetadata {
  visual_ui_detected: boolean;
}

export interface ProbeDeps {
  bucket: Pick<R2Bucket, 'delete'>;
  processAv: (payload: ProbeJobPayload, objectKey: string) => Promise<ProbeMetadata>;
  writeMetadata: (videoId: string, metadata: ProbeMetadata) => Promise<void>;
}

/** Mock A/V step: replace with the real extraction + analysis stage. */
export const mockProcessAv: ProbeDeps['processAv'] = () => Promise.resolve({ visual_ui_detected: false });

/** R2 object key under which a video's probe extract is stored. */
export const probeObjectKey = (videoId: string): string => `probes/${videoId}`;

/** Runs one probe job: A/V processing, metadata write, then early-GC delete of the R2 object in `finally`. */
export const handleProbeJob = async (payload: ProbeJobPayload, deps: ProbeDeps): Promise<ProbeMetadata> => {
  const objectKey = probeObjectKey(payload.videoId);
  try {
    const metadata = await deps.processAv(payload, objectKey);
    await deps.writeMetadata(payload.videoId, metadata);
    return metadata;
  } finally {
    // Early GC: a delete failure must never mask the job outcome or error.
    try {
      await deps.bucket.delete(objectKey);
    } catch (error) {
      Sentry.captureException(error, {
        tags: { operation: 'probe-early-gc' },
        extra: { videoId: payload.videoId, objectKey },
      });
    }
  }
};
