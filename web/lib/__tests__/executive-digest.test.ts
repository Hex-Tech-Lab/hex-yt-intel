/**
 * Executive Digest (Dimension 0) tier parser.
 * Locks the extraction of the four `#### 0.x` tiers from a digest completion,
 * including fence tolerance, bullet normalisation, and the absent-digest case.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseExecutiveDigest, buildExecutiveDigestUserMessage, EXECUTIVE_DIGEST_SYSTEM_FALLBACK } from '@/lib/prompts/executive-digest';
import { CHAT_GROUNDING_INSTRUCTIONS_FALLBACK } from '@/lib/prompts/chat-grounding';

const SAMPLE = [
  '#### 0.1 Snapshot',
  'A concise recipe walkthrough for a classic vanilla cake, aimed at home bakers.',
  '',
  '#### 0.2 Overview',
  'The video opens with ingredients.',
  '',
  'It then walks through mixing and baking, closing with frosting options.',
  '',
  '#### 0.3 Key Takeaways',
  '- Uses 2 cups flour and 1½ cups sugar',
  '* Cream butter before adding eggs',
  '• Bake at 350°F for 30 minutes',
].join('\n');

describe('parseExecutiveDigest', () => {
  it('extracts all three tiers', () => {
    const digest = parseExecutiveDigest(SAMPLE);
    expect(digest).not.toBeNull();
    if (!digest) return;
    expect(digest.snapshot).toContain('vanilla cake');
    expect(digest.overview).toContain('frosting options');
    expect(digest.overview.split(/\n\s*\n/u)).toHaveLength(2); // two paragraphs preserved
  });

  it('normalises bullets across -, * and • markers', () => {
    const digest = parseExecutiveDigest(SAMPLE);
    expect(digest).not.toBeNull();
    if (!digest) return;
    expect(digest.takeaways).toHaveLength(3);
    expect(digest.takeaways[0]).toBe('Uses 2 cups flour and 1½ cups sugar');
    expect(digest.takeaways[2]).toBe('Bake at 350°F for 30 minutes');
  });

  it('tolerates a leading ```-fence', () => {
    const fenced = ['```markdown', SAMPLE, '```'].join('\n');
    const digest = parseExecutiveDigest(fenced);
    expect(digest).not.toBeNull();
    if (!digest) return;
    expect(digest.snapshot).toContain('vanilla cake');
  });

  it('returns null when no tiers are present', () => {
    expect(parseExecutiveDigest('just some prose, no headers')).toBeNull();
    expect(parseExecutiveDigest('')).toBeNull();
    expect(parseExecutiveDigest(null)).toBeNull();
  });

  it('survives a partial digest (only one tier emitted)', () => {
    const digest = parseExecutiveDigest('#### 0.1 Snapshot\nOnly the snapshot was produced.');
    expect(digest).not.toBeNull();
    if (!digest) return;
    expect(digest.snapshot).toContain('Only the snapshot');
    expect(digest.takeaways).toHaveLength(2); // fallback: first 5 non-empty lines
    expect(digest.overview).toContain('Only the snapshot'); // fallback: raw markdown
  });
});

describe('buildExecutiveDigestUserMessage', () => {
  it('embeds the trimmed analysis markdown', () => {
    const message = buildExecutiveDigestUserMessage('   ### DIMENSION 1\ncontent  ');
    expect(message).toContain('### DIMENSION 1');
    expect(message.startsWith('Here is the completed')).toBe(true);
  });
});

describe('T4 key takeaways cap (prompt wording)', () => {
  it('digest 0.3 states the 3-12 bullet cap and aim 5-9', () => {
    expect(EXECUTIVE_DIGEST_SYSTEM_FALLBACK).toContain('#### 0.3 Key Takeaways');
    expect(EXECUTIVE_DIGEST_SYSTEM_FALLBACK).toContain('3–12 bullets');
    expect(EXECUTIVE_DIGEST_SYSTEM_FALLBACK).toContain('aim for 5–9');
    expect(EXECUTIVE_DIGEST_SYSTEM_FALLBACK).toContain('never exceed 12');
    expect(EXECUTIVE_DIGEST_SYSTEM_FALLBACK).not.toContain('Up to 10 bullets');
  });

  it('chat grounding fallback carries the KEY TAKEAWAYS TABLE rule', () => {
    expect(CHAT_GROUNDING_INSTRUCTIONS_FALLBACK).toContain('KEY TAKEAWAYS TABLE');
    expect(CHAT_GROUNDING_INSTRUCTIONS_FALLBACK).toContain('mirroring the digest');
    expect(CHAT_GROUNDING_INSTRUCTIONS_FALLBACK).toContain('| Timestamp | Takeaway |');
  });

  it('parser keeps a 12-bullet digest as-is (no silent truncation at the cap)', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 12; i += 1) lines.push(`- Point ${i}`);
    const bullets = lines.join('\n');
    const md = `#### 0.1 Snapshot\nS\n\n#### 0.2 Overview\nO\n\n#### 0.3 Key Takeaways\n${bullets}\n\n#### 0.4 Detailed Summary\nD`;
    const digest = parseExecutiveDigest(md);
    expect(digest.takeaways).toHaveLength(12);
  });
});

describe('T4 key takeaways: cap and migration/fallback sync', () => {
  it('caps 0.3 at 12 bullets: a 13th is dropped', () => {
    const bullets = Array.from({ length: 13 }, (unused, i) => `- Point ${i + 1}`).join('\n');
    const md = `#### 0.1 Snapshot\nS\n\n#### 0.2 Overview\nO\n\n#### 0.3 Key Takeaways\n${bullets}\n\n#### 0.4 Detailed Summary\nD`;
    const digest = parseExecutiveDigest(md);
    expect(digest.takeaways).toHaveLength(12);
    expect(digest.takeaways).not.toContain('Point 13');
  });

  it('migration v3 digest text equals the fallback, and the chat rule is in the fallback', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../../supabase/migrations/20261013100000_key_takeaways_redesign.sql'),
      'utf8',
    );
    const digest = sql.match(/\$vault\$([\s\S]*?)\$vault\$/u)?.[1];
    const chatRule = sql.match(/\$add\$([\s\S]*?)\$add\$/u)?.[1];
    expect(digest).toBe(EXECUTIVE_DIGEST_SYSTEM_FALLBACK);
    expect(chatRule).toBeDefined();
    expect(CHAT_GROUNDING_INSTRUCTIONS_FALLBACK).toContain(chatRule!);
  });
});
