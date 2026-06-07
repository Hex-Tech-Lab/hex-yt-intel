import { fetchWorkerMetadata } from '@/lib/services/metadata';
import { fetchSubtitles } from '@/lib/services/decodo';
import { detectPersona } from '@/lib/prompts';
import type { IIngestionPort, VideoMetadata, IngestionResult } from '@/lib/ports/IIngestionPort';
import type { PersonaId } from '@/lib/prompts';
import type { UserTier } from '@/lib/types/billing';
import type { AnalysisJobMetadata } from '@/lib/types/contracts';

export class WorkerIngestionAdapter implements IIngestionPort {
  async fetch(videoId: string): Promise<IngestionResult> {
    const [metadataResult, transcriptResult] = await Promise.allSettled([
      fetchWorkerMetadata(videoId),
      fetchSubtitles(videoId),
    ]);

    if (metadataResult.status === 'rejected') {
      throw new Error('Failed to fetch video metadata');
    }

    let transcript = '';
    let transcriptAvailable = false;
    if (transcriptResult.status === 'fulfilled' && transcriptResult.value.success) {
      transcript = transcriptResult.value.transcript ?? '';
      transcriptAvailable = transcript.trim().length > 0;
    }

    const meta = metadataResult.value;
    const metadata: VideoMetadata = {
      title: meta.title,
      channelTitle: meta.channelTitle,
      publishedAt: meta.publishedAt,
      duration: meta.duration ?? 0,
      viewCount: Number(meta.viewCount) || 0,
      likeCount: Number(meta.likeCount) || 0,
      commentCount: Number(meta.commentCount) || 0,
    };

    return { metadata, transcript, transcriptAvailable };
  }

  detectPersona(params: {
    title: string;
    channelTitle: string;
    explicitPersona?: PersonaId;
  }): PersonaId {
    if (params.explicitPersona) {
      return params.explicitPersona;
    }
    return detectPersona(params.title, params.channelTitle);
  }

  resolveModels(_tier: UserTier, _kind: 'analysis' | 'chat'): Promise<string[]> {
    throw new Error('WorkerIngestionAdapter: resolveModels not supported');
  }

  signToken(_params: { videoId: string; analysisId: string; models: string[] }) {
    throw new Error('WorkerIngestionAdapter: signToken not supported');
  }

  buildJobMetadata(metadata: VideoMetadata): AnalysisJobMetadata {
    return {
      title: metadata.title,
      channelTitle: metadata.channelTitle,
      publishedAt: metadata.publishedAt,
      duration: metadata.duration,
      viewCount: String(metadata.viewCount),
      likeCount: String(metadata.likeCount),
      commentCount: String(metadata.commentCount),
    };
  }
}