import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

export interface TranscriptRow {
  video_id: string;
  content: string;
  segments: any[];
  language: string;
  created_at: string;
  expires_at: string;
  last_accessed_at: string;
  transcript_hash: string | null;
}

export interface TranscriptMarker {
  video_id: string;
  idx: number;
  start_seconds: number;
  end_seconds: number;
  keywords: string[];
  entities: string[];
  quote_hash: string;
  importance: number;
  dim_refs: number[];
  genre: string;
  source: string;
}

export class SupabaseTranscriptAdapter {
  static async upsertTranscript(params: {
    videoId: string;
    content: string;
    segments: any[];
    language: string;
    hash?: string;
  }): Promise<void> {
    const service = getSupabaseServiceClient();
    const { error } = await service
      .from('transcripts')
      .upsert({
        video_id: params.videoId,
        content: params.content,
        segments: params.segments,
        language: params.language,
        transcript_hash: params.hash,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        last_accessed_at: new Date().toISOString(),
      }, { onConflict: 'video_id' });
    if (error) {
      Sentry.captureException(error, { tags: { method: 'upsertTranscript' }, extra: { videoId: params.videoId } });
      throw error;
    }
  }

  static async getTranscript(videoId: string): Promise<TranscriptRow | null> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.from('transcripts').select('*').eq('video_id', videoId).maybeSingle();
    if (error) throw error;
    if (data) {
      await service.from('transcripts').update({ last_accessed_at: new Date().toISOString() }).eq('video_id', videoId);
    }
    return data as TranscriptRow | null;
  }

  static async saveMarkers(markers: TranscriptMarker[]): Promise<void> {
    if (markers.length === 0) return;
    const service = getSupabaseServiceClient();
    // Delete all existing markers for this video before upsert to prevent ghost rows on shrinking re-runs
    await service.from('transcript_markers').delete().eq('video_id', markers[0]!.video_id);
    const { error } = await service.from('transcript_markers').upsert(markers, { onConflict: 'video_id,idx' });
    if (error) {
      Sentry.captureException(error, { tags: { method: 'saveMarkers' } });
      throw error;
    }
  }

  static async getMarkers(videoId: string): Promise<TranscriptMarker[]> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.from('transcript_markers').select('*').eq('video_id', videoId).order('start_seconds', { ascending: true });
    if (error) throw error;
    return (data as TranscriptMarker[]) || [];
  }

  static async purgeExpired(): Promise<{ videoId: string; deletedAt: string }[]> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.rpc('purge_expired_transcripts');
    if (error) throw error;
    return data || [];
  }

  static async complianceCheck(): Promise<{ violations: number; maxAge: string | null }> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.rpc('compliance_check_transcripts');
    if (error) throw error;
    const row = (data as any[])?.[0];
    return { violations: row?.violations || 0, maxAge: row?.max_age || null };
  }
}

export function calculateDynamicBudget(
  durationSeconds: number,
  drift: number,
  entityChurn: number,
  chapters: number,
  genre: string
): number {
  const L = durationSeconds / 60;
  const alpha = 0.8, beta = 12, gamma = 3, delta = 2;
  let factor = 1;
  let minM = 8, maxM = 150;

  if (genre === 'tutorial') { factor = 1.5; minM = 15; maxM = 150; }
  else if (genre === 'monologue') { factor = 0.6; minM = 8; maxM = 40; }
  else if (genre === 'movie') { factor = 0.8; minM = 15; maxM = 90; }
  else if (genre === 'news') { factor = 1.2; minM = 12; maxM = 80; }

  if (L < 5) { maxM = Math.min(maxM, 20); }
  else if (L < 20) { minM = Math.max(minM, 12); maxM = Math.min(maxM, 50); }
  else if (L < 60) { minM = Math.max(minM, 30); maxM = Math.min(maxM, 90); }
  else { minM = Math.max(minM, 60); }

  const raw = Math.floor((alpha * L + beta * drift + gamma * entityChurn + delta * chapters) * factor);
  return Math.max(minM, Math.min(maxM, raw));
}

export function deduplicateMarkers(markers: TranscriptMarker[], thresholdSeconds = 5): TranscriptMarker[] {
  if (markers.length === 0) return [];
  const sorted = [...markers].sort((a, b) => a.start_seconds - b.start_seconds);
  const result: TranscriptMarker[] = [];
  let cluster: TranscriptMarker[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i]!;
    const anchorStart = cluster[0]!.start_seconds;
    if (Math.abs(curr.start_seconds - anchorStart) < thresholdSeconds) {
      cluster.push(curr);
    } else {
      const best = cluster.reduce((best, m) => (m.importance > best.importance ? m : best), cluster[0]!);
      result.push(best);
      cluster = [curr];
    }
  }
  if (cluster.length > 0) {
    const best = cluster.reduce((best, m) => (m.importance > best.importance ? m : best), cluster[0]!);
    result.push(best);
  }
  return result.map((m, idx) => ({ ...m, idx }));
}
