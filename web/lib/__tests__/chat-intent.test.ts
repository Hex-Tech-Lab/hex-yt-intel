import { describe, it, expect } from 'vitest';
import { isWritingRequest } from '@/lib/utils/chat-intent';

describe('isWritingRequest (T21)', () => {
  it.each([
    'Write a LinkedIn post about the main takeaway',
    'draft a blog article from this video',
    'Turn this into a tweet thread',
    'make me a 60-second script for TikTok',
    'Compose a newsletter intro',
  ])('routes "%s" to writing', (msg) => expect(isWritingRequest(msg)).toBe(true));

  it.each([
    'What did the speaker say about pricing?',
    'what did the blog section say?',
    'Summarize the key points',
    'When does he mention the script?',
  ])('keeps "%s" on chat', (msg) => expect(isWritingRequest(msg)).toBe(false));
});
