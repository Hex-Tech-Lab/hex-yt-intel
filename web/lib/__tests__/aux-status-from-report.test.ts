import { describe, it, expect } from 'vitest';
import { auxStatusFromAnalysisPayload } from '@/lib/utils/aux-status-from-report';

describe('auxStatusFromAnalysisPayload', () => {
  it('returns all-false for null/undefined report', () => {
    expect(auxStatusFromAnalysisPayload(null)).toEqual({ hasDescription: false, hasChannelMeta: false, hasComments: false });
    expect(auxStatusFromAnalysisPayload(undefined)).toEqual({ hasDescription: false, hasChannelMeta: false, hasComments: false });
  });

  describe('hasDescription', () => {
    it('is true for a non-empty string', () => {
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: 'hello' } }).hasDescription).toBe(true);
    });

    it('is false for an empty string', () => {
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: '' } }).hasDescription).toBe(false);
    });

    it('is false for a space-only string (matches Postgres trim(both from ...))', () => {
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: '   ' } }).hasDescription).toBe(false);
    });

    it('is true for a tab/newline-only string (Postgres trim only strips ASCII spaces)', () => {
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: '\t\n' } }).hasDescription).toBe(true);
    });

    it('is true for a non-string scalar, mirroring ->> text coercion', () => {
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: 0 as unknown as string } }).hasDescription).toBe(true);
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: false as unknown as string } }).hasDescription).toBe(true);
    });

    it('is true for an empty array/object, mirroring ->> JSON text serialization', () => {
      // ->> on a JSON array/object value yields its text form ('[]', '{}'),
      // which is non-empty -- String([]) would wrongly give '' here.
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: [] as unknown as string } }).hasDescription).toBe(true);
      expect(auxStatusFromAnalysisPayload({ videoMetadata: { description: {} as unknown as string } }).hasDescription).toBe(true);
    });

    it('is false when description is missing entirely', () => {
      expect(auxStatusFromAnalysisPayload({ videoMetadata: {} }).hasDescription).toBe(false);
      expect(auxStatusFromAnalysisPayload({}).hasDescription).toBe(false);
    });
  });

  describe('hasChannelMeta', () => {
    it('is true for a non-empty object', () => {
      expect(auxStatusFromAnalysisPayload({ channelMeta: { a: 1 } }).hasChannelMeta).toBe(true);
    });

    it('is false for an empty object', () => {
      expect(auxStatusFromAnalysisPayload({ channelMeta: {} }).hasChannelMeta).toBe(false);
    });

    it('is false for null/missing channelMeta', () => {
      expect(auxStatusFromAnalysisPayload({ channelMeta: null }).hasChannelMeta).toBe(false);
      expect(auxStatusFromAnalysisPayload({}).hasChannelMeta).toBe(false);
    });

    it('is false when channelMeta is an array (not a plain object)', () => {
      expect(auxStatusFromAnalysisPayload({ channelMeta: [] as unknown as Record<string, unknown> }).hasChannelMeta).toBe(false);
    });
  });

  describe('hasComments', () => {
    it('is true for a non-empty array', () => {
      expect(auxStatusFromAnalysisPayload({ comments: ['a comment'] }).hasComments).toBe(true);
    });

    it('is false for an empty array', () => {
      expect(auxStatusFromAnalysisPayload({ comments: [] }).hasComments).toBe(false);
    });

    it('is false for null/missing comments', () => {
      expect(auxStatusFromAnalysisPayload({ comments: null }).hasComments).toBe(false);
      expect(auxStatusFromAnalysisPayload({}).hasComments).toBe(false);
    });
  });
});
