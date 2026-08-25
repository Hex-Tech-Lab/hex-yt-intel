const fs = require('fs');

let tests = fs.readFileSync('web/lib/__tests__/highlights-parser-reconciliation.test.ts', 'utf8');

// Replace the two clamping tests
const oldClampingTests = `  it('clamps sub-min-duration highlights instead of dropping them', () => {
    // start=10, end=11 → duration=1, below min=5. Should clamp to start+5=15, not drop.
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 11, label: 'short point', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.start).toBe(10);
    expect(result.highlights[0]!.end).toBe(15); // clamped to start + min
  });

  it('clamps over-max-duration highlights instead of dropping them', () => {
    // start=10, end=100 → duration=90, above max=60. Should clamp to start+60=70, not drop.
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 100, label: 'long discussion', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.end).toBe(70); // clamped to start + max
  });

  it('keeps highlights within [min, max] unchanged', () => {
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start: 10, end: 20, label: 'normal highlight', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.start).toBe(10);
    expect(result.highlights[0]!.end).toBe(20);
  });`;

const newClampingTests = `  it.each([
    { desc: 'clamps sub-min-duration', start: 10, end: 11, expectedStart: 10, expectedEnd: 15 },
    { desc: 'clamps over-max-duration', start: 10, end: 100, expectedStart: 10, expectedEnd: 70 },
    { desc: 'keeps within bounds', start: 10, end: 20, expectedStart: 10, expectedEnd: 20 }
  ])('$desc', ({ start, end, expectedStart, expectedEnd }) => {
    const result = parseHighlightsExtraction(
      JSON.stringify([{ start, end, label: 'point', takeawayIdx: null }]),
      VALID_STARTS,
      40,
      5,
      60,
      0
    );
    expect(result.status).toBe('ok');
    expect(result.highlights).toHaveLength(1);
    expect(result.highlights[0]!.start).toBe(expectedStart);
    expect(result.highlights[0]!.end).toBe(expectedEnd);
  });`;

tests = tests.replace(oldClampingTests, newClampingTests);
fs.writeFileSync('web/lib/__tests__/highlights-parser-reconciliation.test.ts', tests);

console.log('Test file refactored');
