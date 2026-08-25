const fs = require('fs');
let file = 'web/lib/hooks/useSegmentPlayback.test.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /  it\('falls back to segmentDurationSeconds when end is missing[\s\S]*?expect\(result\.current\.playingIdx\)\.toBeNull\(\); \/\/ advanced past last segment\n  }\);\n/g;
const newInvalidBlock = `  it.each([
    { desc: 'end is missing', segments: [{ start: 10 }] as any, time: 13, expectedIdx: null },
    { desc: 'end is NaN', segments: [{ start: 10, end: NaN }], time: 13, expectedIdx: null },
    { desc: 'end < start', segments: [{ start: 10, end: 5 }], time: 13, expectedIdx: null }
  ])('falls back to segmentDurationSeconds when $desc (invalid data)', ({ segments, time, expectedIdx }) => {
    const fake = makeFakePrimitives(0);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(250));
    act(() => { fake.setTime(time); vi.advanceTimersByTime(250); });
    expect(result.current.playingIdx).toBe(expectedIdx);
  });
`;

if (regex.test(code)) {
  code = code.replace(regex, newInvalidBlock);
  fs.writeFileSync(file, code);
  console.log('Replaced via regex');
} else {
  console.log('Regex did not match.');
}
