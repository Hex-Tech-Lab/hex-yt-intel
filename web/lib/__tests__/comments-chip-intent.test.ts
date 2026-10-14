/**
 * Comments-expansion chip under ADR-043 Part A.
 *
 * A `writing` meta event hides the chip; a `general_grounded_qa` meta event shows it.
 * Negative control: a `writing` fixture with comment keywords and more comments
 * available must not render the chip. Legacy turns (no meta) keep the keyword path.
 */

import { describe, it, expect } from 'vitest';
import { parseTurnIntentMeta, shouldOfferCommentsChip } from '../utils/comments-chip';

const writingFrame = {
  tier: 'pro',
  models: [],
  cascade: [],
  requestId: 'req-1',
  intent: 'writing',
  suppressCommentsChip: true,
  suppressTimestamps: true,
  modelTier: 'primary',
  intentVersion: 1,
};

const qaFrame = {
  ...writingFrame,
  intent: 'general_grounded_qa',
  suppressCommentsChip: false,
  suppressTimestamps: false,
};

const COMMENTY_USER = 'Write a LinkedIn post summarising what the commenters think';
const COMMENTY_ASSISTANT = 'Here is a post that reflects the viewer feedback and audience reaction.';

describe('comments chip under chat intent (ADR-043 Part A)', () => {
  describe('parseTurnIntentMeta', () => {
    it('parses a writing meta frame', () => {
      expect(parseTurnIntentMeta(writingFrame)).toMatchObject({ intent: 'writing', suppressCommentsChip: true });
    });

    it('returns null for a frame without intent fields (router disabled, or a delta)', () => {
      expect(parseTurnIntentMeta({ tier: 'pro', models: [], cascade: [], requestId: 'r' })).toBeNull();
      expect(parseTurnIntentMeta({ type: 'delta', content: 'hi', requestId: 'r' })).toBeNull();
    });

    it('rejects an unknown intent version', () => {
      expect(parseTurnIntentMeta({ ...writingFrame, intentVersion: 2 })).toBeNull();
    });

    it('rejects an intent outside the closed set', () => {
      expect(parseTurnIntentMeta({ ...writingFrame, intent: 'creative_writing' })).toBeNull();
    });
  });

  describe('shouldOfferCommentsChip', () => {
    it('hides the chip on a writing turn, even with comment keywords and more comments', () => {
      const meta = parseTurnIntentMeta(writingFrame);
      expect(shouldOfferCommentsChip({
        hasMoreComments: true,
        intentMeta: meta,
        userText: COMMENTY_USER,
        assistantText: COMMENTY_ASSISTANT,
      })).toBe(false);
    });

    it('shows the chip on a general_grounded_qa turn when more comments exist', () => {
      const meta = parseTurnIntentMeta(qaFrame);
      expect(shouldOfferCommentsChip({
        hasMoreComments: true,
        intentMeta: meta,
        userText: 'What is the main argument?',
        assistantText: 'The speaker argues for smaller teams.',
      })).toBe(true);
    });

    it('never shows the chip when the sample is complete', () => {
      const meta = parseTurnIntentMeta(qaFrame);
      expect(shouldOfferCommentsChip({
        hasMoreComments: false,
        intentMeta: meta,
        userText: COMMENTY_USER,
        assistantText: COMMENTY_ASSISTANT,
      })).toBe(false);
    });

    it('keeps the legacy keyword path on a turn with no intent metadata', () => {
      expect(shouldOfferCommentsChip({
        hasMoreComments: true,
        intentMeta: null,
        userText: COMMENTY_USER,
        assistantText: COMMENTY_ASSISTANT,
      })).toBe(true);
      expect(shouldOfferCommentsChip({
        hasMoreComments: true,
        intentMeta: undefined,
        userText: 'What is the main argument?',
        assistantText: 'The speaker argues for smaller teams.',
      })).toBe(false);
    });
  });
});
