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
    const d = parseExecutiveDigest(SAMPLE);
    expect(d).not.toBeNull();
    expect(d!.snapshot).toContain('vanilla cake');
    expect(d!.overview).toContain('frosting options');
    expect(d!.overview.split(/\n\s*\n/).length).toBe(2); // two paragraphs preserved
  });

  it('normalises bullets across -, * and • markers', () => {
    const d = parseExecutiveDigest(SAMPLE)!;
    expect(d.takeaways).toHaveLength(3);
    expect(d.takeaways[0]).toBe('Uses 2 cups flour and 1½ cups sugar');
    expect(d.takeaways[2]).toBe('Bake at 350°F for 30 minutes');
  });

  it('tolerates a leading ```-fence', () => {
    const fenced = '```markdown\n' + SAMPLE + '\n```';
    const d = parseExecutiveDigest(fenced);
    expect(d).not.toBeNull();
    expect(d!.snapshot).toContain('vanilla cake');
  });

  it('returns null when no tiers are present', () => {
    expect(parseExecutiveDigest('just some prose, no headers')).toBeNull();
    expect(parseExecutiveDigest('')).toBeNull();
    expect(parseExecutiveDigest(null)).toBeNull();
  });

  it('survives a partial digest (only one tier emitted)', () => {
    const d = parseExecutiveDigest('#### 0.1 Snapshot\nOnly the snapshot was produced.');
    expect(d).not.toBeNull();
    expect(d!.snapshot).toContain('Only the snapshot');
    expect(d!.takeaways).toHaveLength(0);
    expect(d!.overview).toBe('');
  });
});

describe('buildExecutiveDigestUserMessage', () => {
  it('embeds the trimmed analysis markdown', () => {
    const msg = buildExecutiveDigestUserMessage('   ### DIMENSION 1\ncontent  ');
    expect(msg).toContain('### DIMENSION 1');
    expect(msg.startsWith('Here is the completed')).toBe(true);
  });
});
