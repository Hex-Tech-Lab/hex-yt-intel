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

/** Chapter-row shape mirroring public.transcript_chapters. */
export interface ChapterRow {
  video_id: string;
  idx: number;
  start_seconds: number;
  end_seconds: number;
  label: string;
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

    // Check if row already exists to preserve retention timestamps on update
    const { data: existing } = await service
      .from('transcripts')
      .select('video_id')
      .eq('video_id', params.videoId)
      .maybeSingle();

    // Build upsert payload, conditionally including timestamp fields
    // 72h compliance retention must anchor to the row's true first-seen time — do not reset on update
    const upsertPayload: any = {
      video_id: params.videoId,
      content: params.content,
      segments: params.segments,
      language: params.language,
      transcript_hash: params.hash,
      last_accessed_at: new Date().toISOString(),
    };

    // Only set creation and expiration timestamps on first insert, not on subsequent updates.
    // Known limitation: this is check-then-upsert, not atomic — two concurrent first-ever
    // calls for the same video_id (e.g. chunk-path + finalize-path racing close together)
    // could both see "doesn't exist" and both set these fields, which is harmless (same
    // ~72h window, off by a few ms). The narrower real risk is if a genuine update lands
    // between this SELECT and the UPSERT below; that window is small and the fields would
    // only be wrongly reset once, not on every call as before. A raw SQL upsert with an
    // explicit ON CONFLICT DO UPDATE column list would close this fully if it recurs.
    if (!existing) {
      upsertPayload.created_at = new Date().toISOString();
      upsertPayload.expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    }

    const { error } = await service
      .from('transcripts')
      .upsert(upsertPayload, { onConflict: 'video_id' });
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
    const videoId = markers[0]!.video_id;

    // Upsert the new markers first (safe — if this fails, nothing is lost)
    const { error: upsertError } = await service
      .from('transcript_markers')
      .upsert(markers, { onConflict: 'video_id,idx' });
    if (upsertError) {
      Sentry.captureException(upsertError, { tags: { method: 'saveMarkers' } });
      throw upsertError;
    }

    // Then delete any old markers with higher idx (from previous larger runs)
    const { error: deleteError } = await service
      .from('transcript_markers')
      .delete()
      .eq('video_id', videoId)
      .gt('idx', markers.length - 1);
    if (deleteError) {
      Sentry.captureException(deleteError, { tags: { method: 'saveMarkers-cleanup' }, extra: { videoId } });
    }
  }

  static async getMarkers(videoId: string): Promise<TranscriptMarker[]> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.from('transcript_markers').select('*').eq('video_id', videoId).order('start_seconds', { ascending: true });
    if (error) throw error;
    return (data as TranscriptMarker[]) || [];
  }

  /**
   * Upsert parsed chapters into `transcript_chapters` on (video_id, idx).
   * Mirrors saveMarkers' pattern: upsert new rows, then delete stale rows
   * with idx beyond the current run (a previously-longer chapter list would
   * otherwise leave orphans).
   *
   * Three-state representation (see the v13 history-overview RPC): when
   * `attemptedButEmpty` is true (the worker parsed the description and found
   * zero chapter markers), a sentinel row (idx = -1) is written so the chip
   * renders orange, distinct from grey (no rows, never attempted). When real
   * chapters exist, the sentinel is deleted so the chip renders green. No-op
   * when chapters is empty and not attemptedButEmpty.
   */
  static async upsertChapters(
    videoId: string,
    chapters: ChapterRow[],
    opts?: { attemptedButEmpty?: boolean },
  ): Promise<void> {
    const attemptedButEmpty = opts?.attemptedButEmpty === true;
    if (chapters.length === 0 && !attemptedButEmpty) return;
    const service = getSupabaseServiceClient();

    if (chapters.length > 0) {
      const { error: upsertError } = await service
        .from('transcript_chapters')
        .upsert(chapters, { onConflict: 'video_id,idx' });
      if (upsertError) {
        Sentry.captureException(upsertError, { tags: { method: 'upsertChapters' } });
        throw upsertError;
      }

      // Remove the "attempted but empty" sentinel if one was previously written
      // (a re-analysis that now found chapters must flip orange -> green).
      const { error: sentinelError } = await service
        .from('transcript_chapters')
        .delete()
        .eq('video_id', videoId)
        .eq('idx', -1);
      if (sentinelError) {
        Sentry.captureException(sentinelError, { tags: { method: 'upsertChapters-sentinel' }, extra: { videoId } });
      }

      // Delete stale rows with idx beyond the current run.
      const { error: deleteError } = await service
        .from('transcript_chapters')
        .delete()
        .eq('video_id', videoId)
        .gt('idx', chapters.length - 1);
      if (deleteError) {
        Sentry.captureException(deleteError, { tags: { method: 'upsertChapters-cleanup' }, extra: { videoId } });
      }
    } else if (attemptedButEmpty && videoId) {
      // P0-2 + atomicity fix (2026-08-05 PR #205 review): delete ALL existing
      // real chapter rows (idx >= 0) from a prior analysis run and write the
      // sentinel in a single DB transaction via write_chapter_sentinel(),
      // instead of two separate PostgREST calls. Two separate calls left a
      // window where a failed sentinel write after a successful delete would
      // leave the video with NO chapter rows -- history falls back to grey
      // (never-attempted) instead of orange (attempted, empty), and the
      // failure mode is indistinguishable from the caller's error handling.
      const { error: sentinelRpcError } = await service.rpc('write_chapter_sentinel', {
        p_video_id: videoId,
      });
      if (sentinelRpcError) {
        Sentry.captureException(sentinelRpcError, { tags: { method: 'upsertChapters-sentinel' }, extra: { videoId } });
        throw sentinelRpcError;
      }
    }
  }

  static async getChapters(videoId: string): Promise<ChapterRow[]> {
    const service = getSupabaseServiceClient();
    // idx >= 0 filters out the sentinel (idx = -1) that represents
    // "attempted but empty" — it's a status marker, not a real chapter.
    const { data, error } = await service
      .from('transcript_chapters')
      .select('*')
      .eq('video_id', videoId)
      .gte('idx', 0)
      .order('start_seconds', { ascending: true });
    if (error) throw error;
    return (data as ChapterRow[]) || [];
  }

  static async purgeExpiredChapters(): Promise<{ videoId: string; deletedAt: string }[]> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.rpc('purge_expired_chapters');
    if (error) throw error;
    // purge_expired_chapters() returns snake_case columns (video_id,
    // deleted_at) -- map to the declared camelCase return shape rather than
    // returning the raw rows, which would make .videoId/.deletedAt undefined
    // for any caller that reads past .length.
    return ((data as { video_id: string; deleted_at: string }[]) || []).map((row) => ({
      videoId: row.video_id,
      deletedAt: row.deleted_at,
    }));
  }

  static async complianceCheckChapters(): Promise<{ violations: number; maxAge: string | null }> {
    const service = getSupabaseServiceClient();
    const { data, error } = await service.rpc('compliance_check_chapters');
    if (error) throw error;
    if (data && data.length > 0) {
      return { violations: data[0]!.violations, maxAge: data[0]!.max_age };
    }
    return { violations: 0, maxAge: null };
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
