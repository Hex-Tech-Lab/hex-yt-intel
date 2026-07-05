/**
 * JSON is the source of truth; markdown is a reconstruction of it. This locks
 * the invariant that reconstructMarkdown() is a 1:1 mapping at the dimension
 * level — every JSON `dimensions[]` entry becomes exactly one "### DIMENSION N"
 * header, so counting the reconstructed markdown always agrees with counting the
 * JSON payload. (Content fidelity of a dimension body — e.g. a missing "7.1"
 * sub-numbering — is a generation concern, not a reconstruction one: the body is
 * copied verbatim.)
 */
import { describe, it, expect } from 'vitest';
import { reconstructMarkdown } from '@/lib/utils/markdown-reconstructor';
import { parseUcisDimensionNumbers } from '@/lib/utils/count-ucis-dimensions';

function payload(nums: number[]) {
  return {
    schemaVersion: '2.0',
    dimensions: nums.map((n) => ({ number: n, name: `Dim ${n}`, content: `Body for ${n}\n\n7.1 sub-point` })),
  } as never;
}

const FENCE = '```';

describe('reconstructMarkdown is 1:1 with the JSON dimensions', () => {
  it('all 11 dimensions round-trip to 11 markdown headers', () => {
    const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(parseUcisDimensionNumbers(reconstructMarkdown(payload(nums)))).toEqual(nums);
  });

  it('a partial set round-trips exactly — no dimension gained or lost', () => {
    expect(parseUcisDimensionNumbers(reconstructMarkdown(payload([5, 7, 10])))).toEqual([5, 7, 10]);
  });

  it('counting the JSON source and its markdown reconstruction agree', () => {
    const p = payload([1, 2, 3, 4, 5, 6, 7, 8]);
    const fromJson = parseUcisDimensionNumbers(`${FENCE}json\n${JSON.stringify(p)}\n${FENCE}`);
    const fromMarkdown = parseUcisDimensionNumbers(reconstructMarkdown(p));
    expect(fromMarkdown).toEqual(fromJson);
  });
});
