// @vitest-environment happy-dom
// T9: the reel header's dynamic figures render in <strong> (numeral + unit).
import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReelStatsLine } from '@/components/dashboard/HighlightsScrubber';

describe('ReelStatsLine (T9)', () => {
  it('renders the key figures inside <strong>', () => {
    const { container } = render(
      <ReelStatsLine count={15} totalSeconds={240} videoDurationSeconds={4140} compressionPct={6} />
    );
    const strongs = Array.from(container.querySelectorAll('strong')).map((el) => el.textContent);
    expect(strongs).toEqual(['15 key points', '4m00s', '69m00s', '6%']);
  });

  it('omits the video-duration and compression figures when unavailable', () => {
    const { container } = render(
      <ReelStatsLine count={3} totalSeconds={45} videoDurationSeconds={null} compressionPct={null} />
    );
    const strongs = Array.from(container.querySelectorAll('strong')).map((el) => el.textContent);
    expect(strongs).toEqual(['3 key points', '45s']);
  });
});
