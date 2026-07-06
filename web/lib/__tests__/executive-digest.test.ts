/**
 * Executive Digest (Dimension 0) tier parser.
 * Locks the extraction of the three `#### 0.x` tiers from a digest completion,
 * including fence tolerance, bullet normalisation, and the absent-digest case.
 */
import { parseExecutiveDigest, buildExecutiveDigestUserMessage } from '@/lib/prompts/executive-digest';

const SAMPLE = [
  '#### 0.1 Snapshot',
  'A concise recipe walkthrough for a classic vanilla cake, aimed at home bakers.',
  '',
  '#### 0.2 Key Takeaways',
  '- Uses 2 cups flour and 1½ cups sugar',
  '* Cream butter before adding eggs',
  '• Bake at 350°F for 30 minutes',
  '',
  '#### 0.3 Overview',
  'The video opens with ingredients.',
  '',
  'It then walks through mixing and baking, closing with frosting options.',
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
    expect(digest.takeaways).toHaveLength(0);
    expect(digest.overview).toBe('');
  });
});

describe('buildExecutiveDigestUserMessage', () => {
  it('embeds the trimmed analysis markdown', () => {
    const message = buildExecutiveDigestUserMessage('   ### DIMENSION 1\ncontent  ');
    expect(message).toContain('### DIMENSION 1');
    expect(message.startsWith('Here is the completed')).toBe(true);
  });
});
