import { describe, it, expect } from 'vitest';
import { findMatchingConversation, filterConversationsForContext } from '@/lib/utils/find-chat-conversation';
import type { ChatConversation } from '@/lib/types/chat';

// Real YouTube video IDs are always exactly 11 chars -- use realistic ones
// in fixtures (not 'v1') since stripArchivedVideoIdSuffix's suffix regex is
// anchored to that length (see archived-video-id.test.ts).
const VID = 'dQw4w9WgXcQ';
const VID2 = 'AbCdEfGhIjK';
const VID3 = 'ZyXwVuTsRqP';

function conv(overrides: Partial<ChatConversation>): ChatConversation {
  return {
    id: 'conv-id',
    userId: 'user-1',
    title: 'Untitled',
    analysisId: null,
    videoId: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastMessageAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('findMatchingConversation', () => {
  it('matches by exact analysisId', () => {
    const target = conv({ id: 'target', analysisId: 'a1' });
    const result = findMatchingConversation([conv({ id: 'other', analysisId: 'a2' }), target], 'a1', VID);
    expect(result?.id).toBe('target');
  });

  it('matches by exact videoId when no analysisId match', () => {
    const target = conv({ id: 'target', analysisId: 'a-other', videoId: VID });
    const result = findMatchingConversation([target], 'a1', VID);
    expect(result?.id).toBe('target');
  });

  it('matches by archived-suffix-stripped videoId on the query side', () => {
    const target = conv({ id: 'target', videoId: VID });
    const result = findMatchingConversation([target], null, `${VID}_archived_1785407155.751134`);
    expect(result?.id).toBe('target');
  });

  it('matches by archived-suffix-stripped videoId on the stored side', () => {
    const target = conv({ id: 'target', videoId: `${VID}_archived_1785407155.751134` });
    const result = findMatchingConversation([target], null, VID);
    expect(result?.id).toBe('target');
  });

  it('returns undefined when nothing matches', () => {
    const result = findMatchingConversation([conv({ id: 'other', analysisId: 'a-other', videoId: VID2 })], 'a1', VID);
    expect(result).toBeUndefined();
  });

  it('returns undefined for null/undefined analysisId and videoId', () => {
    const result = findMatchingConversation([conv({ id: 'other' })], null, undefined);
    expect(result).toBeUndefined();
  });

  it('prioritizes exact analysisId over a looser videoId match earlier in the array', () => {
    // Regression test: cubic/Qodo review, PR #177 -- a single OR'd .find()
    // let array order decide the winner instead of match specificity, so an
    // older conversation matching only by videoId could beat a newer, more
    // specific analysisId match and get incorrectly rebound.
    const looseVideoMatch = conv({ id: 'loose', analysisId: 'a-old', videoId: VID });
    const exactAnalysisMatch = conv({ id: 'exact', analysisId: 'a1', videoId: VID2 });
    const result = findMatchingConversation([looseVideoMatch, exactAnalysisMatch], 'a1', VID);
    expect(result?.id).toBe('exact');
  });

  it('prioritizes exact videoId over archived-suffix-stripped match', () => {
    const strippedMatch = conv({ id: 'stripped', videoId: `${VID}_archived_999` });
    const exactMatch = conv({ id: 'exact', videoId: VID });
    const result = findMatchingConversation([strippedMatch, exactMatch], null, VID);
    expect(result?.id).toBe('exact');
  });

  it('strips the archived suffix unconditionally, matching SQL, even for a short/non-11-char videoId', () => {
    // Regression test: cubic review, PR #177 re-audit -- stripArchivedVideoIdSuffix
    // mirrors the SQL SSOT's unconditional `regexp_replace(video_id,
    // '_archived_.*$', '')` exactly, matching regardless of prefix length.
    // A short videoId with the archived suffix must still match its
    // stripped form, the same as a real 11-char YouTube id would.
    const target = conv({ id: 'target', videoId: 'short_archived_1' });
    const exact = findMatchingConversation([target], null, 'short_archived_1');
    expect(exact?.id).toBe('target');
    const stripped = findMatchingConversation([target], null, 'short');
    expect(stripped?.id).toBe('target');
  });
});

describe('filterConversationsForContext', () => {
  it('excludes conversations from unrelated videos/analyses', () => {
    // Regression test: live-reported 2026-08-01 (screenshot) -- the thread
    // switcher rendered the user's entire global conversation list, so a
    // completely unrelated video's thread appeared while viewing another.
    const thisVideo = conv({ id: 'this-video', analysisId: 'a1', videoId: VID });
    const unrelated = conv({ id: 'unrelated', analysisId: 'a-other', videoId: VID2 });
    const result = filterConversationsForContext([thisVideo, unrelated], 'a1', VID);
    expect(result.map((c) => c.id)).toEqual(['this-video']);
  });

  it('includes all conversations matching by analysisId, videoId, or stripped videoId', () => {
    const byAnalysis = conv({ id: 'by-analysis', analysisId: 'a1', videoId: VID2 });
    const byVideo = conv({ id: 'by-video', analysisId: 'a-other', videoId: VID });
    const byStripped = conv({ id: 'by-stripped', analysisId: 'a-other2', videoId: `${VID}_archived_123` });
    const unrelated = conv({ id: 'unrelated', analysisId: 'a-unrelated', videoId: VID3 });
    const result = filterConversationsForContext([byAnalysis, byVideo, byStripped, unrelated], 'a1', VID);
    expect(result.map((c) => c.id).sort()).toEqual(['by-analysis', 'by-stripped', 'by-video']);
  });

  it('returns an empty array when nothing is grounded and no matches exist', () => {
    const result = filterConversationsForContext([conv({ id: 'other', analysisId: 'a-other', videoId: VID2 })], 'a1', VID);
    expect(result).toEqual([]);
  });

  it('returns every conversation unfiltered when there is no analysis/video context', () => {
    // Regression test: cubic/Qodo review, PR #177 -- filtering to nothing
    // when there's no context made the thread switcher hide every existing
    // conversation, including general (non-video-grounded) chat threads,
    // whenever no video/analysis was active.
    const a = conv({ id: 'a', analysisId: 'a1', videoId: VID });
    const b = conv({ id: 'b', analysisId: null, videoId: null });
    const result = filterConversationsForContext([a, b], null, null);
    expect(result.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });
});
