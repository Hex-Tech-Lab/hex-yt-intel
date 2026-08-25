const fs = require('fs');
let file = 'web/lib/hooks/useSegmentPlayback.test.ts';
let code = fs.readFileSync(file, 'utf8');

const regex = /  it\('falls back to segmentDurationSeconds when segment\.end is null \(legacy data\)', \(\) => \{[\s\S]*\}\);\n\}\);\n$/g;
const newInvalidBlock = `  it.each([
    { desc: 'segment.end is null (legacy data)', segments: [{ start: 10, end: NaN }], time: 13, expectedIdx: null },
    { desc: 'end < start (invalid data)', segments: [{ start: 10, end: 5 }], time: 13, expectedIdx: null }
  ])('falls back to segmentDurationSeconds when $desc', ({ segments, time, expectedIdx }) => {
    const fake = makeFakePrimitives(0);
    const { result } = renderHook(() =>
      useSegmentPlayback({
        segments,
        contextLeadSeconds: 2,
        segmentDurationSeconds: 5,
        primitives: fake.primitives,
      })
    );
    act(() => { result.current.start(); });
    act(() => { vi.advanceTimersByTime(250); });
    act(() => { fake.setTime(time); vi.advanceTimersByTime(250); });
    expect(result.current.playingIdx).toBe(expectedIdx);
  });
});
`;

if (regex.test(code)) {
  code = code.replace(regex, newInvalidBlock);
  fs.writeFileSync(file, code);
  console.log('Replaced via regex');
} else {
  console.log('Regex did not match.');
}
