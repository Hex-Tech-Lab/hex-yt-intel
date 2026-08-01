import { describe, it, expect } from 'vitest';
import { auxStatusFromValidationReport } from '@/lib/utils/aux-status-from-report';

describe('auxStatusFromValidationReport', () => {
  it('returns all-false for null/undefined report', () => {
    expect(auxStatusFromValidationReport(null)).toEqual({ hasDescription: false, hasChannelMeta: false, hasComments: false });
    expect(auxStatusFromValidationReport(undefined)).toEqual({ hasDescription: false, hasChannelMeta: false, hasComments: false });
  });

  describe('hasDescription', () => {
    it('is true for a non-empty string', () => {
      expect(auxStatusFromValidationReport({ metadata: { description: 'hello' } }).hasDescription).toBe(true);
    });

    it('is false for an empty string', () => {
      expect(auxStatusFromValidationReport({ metadata: { description: '' } }).hasDescription).toBe(false);
    });

    it('is false for a space-only string (matches Postgres trim(both from ...))', () => {
      expect(auxStatusFromValidationReport({ metadata: { description: '   ' } }).hasDescription).toBe(false);
    });

    it('is true for a tab/newline-only string (Postgres trim only strips ASCII spaces)', () => {
      expect(auxStatusFromValidationReport({ metadata: { description: '\t\n' } }).hasDescription).toBe(true);
    });

    it('is true for a non-string scalar, mirroring ->> text coercion', () => {
      expect(auxStatusFromValidationReport({ metadata: { description: 0 as unknown as string } }).hasDescription).toBe(true);
      expect(auxStatusFromValidationReport({ metadata: { description: false as unknown as string } }).hasDescription).toBe(true);
    });

    it('is true for an empty array/object, mirroring ->> JSON text serialization', () => {
      // ->> on a JSON array/object value yields its text form ('[]', '{}'),
      // which is non-empty -- String([]) would wrongly give '' here.
      expect(auxStatusFromValidationReport({ metadata: { description: [] as unknown as string } }).hasDescription).toBe(true);
      expect(auxStatusFromValidationReport({ metadata: { description: {} as unknown as string } }).hasDescription).toBe(true);
    });

    it('is false when description is missing entirely', () => {
      expect(auxStatusFromValidationReport({ metadata: {} }).hasDescription).toBe(false);
      expect(auxStatusFromValidationReport({}).hasDescription).toBe(false);
    });
  });

  describe('hasChannelMeta', () => {
    it('is true for a non-empty object', () => {
      expect(auxStatusFromValidationReport({ channelMeta: { a: 1 } }).hasChannelMeta).toBe(true);
    });

    it('is false for an empty object', () => {
      expect(auxStatusFromValidationReport({ channelMeta: {} }).hasChannelMeta).toBe(false);
    });

    it('is false for null/missing channelMeta', () => {
      expect(auxStatusFromValidationReport({ channelMeta: null }).hasChannelMeta).toBe(false);
      expect(auxStatusFromValidationReport({}).hasChannelMeta).toBe(false);
    });

    it('is false when channelMeta is an array (not a plain object)', () => {
      expect(auxStatusFromValidationReport({ channelMeta: [] as unknown as Record<string, unknown> }).hasChannelMeta).toBe(false);
    });
  });

  describe('hasComments', () => {
    it('is true for a non-empty array', () => {
      expect(auxStatusFromValidationReport({ comments: ['a comment'] }).hasComments).toBe(true);
    });

    it('is false for an empty array', () => {
      expect(auxStatusFromValidationReport({ comments: [] }).hasComments).toBe(false);
    });

    it('is false for null/missing comments', () => {
      expect(auxStatusFromValidationReport({ comments: null }).hasComments).toBe(false);
      expect(auxStatusFromValidationReport({}).hasComments).toBe(false);
    });
  });
});
