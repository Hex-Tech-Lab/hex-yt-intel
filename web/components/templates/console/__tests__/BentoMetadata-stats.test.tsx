// @vitest-environment happy-dom
// T11: six compact context cards, with Comments and Engagement added.
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BentoMetadata, formatEngagement } from '@/components/templates/console/BentoMetadata';

describe('formatEngagement', () => {
  it('is (likes + comments) / views', () => {
    expect(formatEngagement('1000', '40', '10')).toBe('5.0%');
    expect(formatEngagement(100, 30, 0)).toBe('30%');
  });
  it('shows a dash when views are unknown or zero', () => {
    expect(formatEngagement('0', '5', '1')).toBe('—');
    expect(formatEngagement('', '5')).toBe('—');
  });
  it('treats missing comments as zero', () => {
    expect(formatEngagement('1000', '50')).toBe('5.0%');
  });
});

describe('BentoMetadata context cards', () => {
  it('renders six stat cards including Comments and Engagement', () => {
    render(
      <BentoMetadata title="T" channelTitle="C" viewCount="2000" likeCount="80" commentCount="20" duration={90} publishedAt="2026-01-02T00:00:00Z" />,
    );
    for (const label of ['Views', 'Likes', 'Comments', 'Engagement', 'Length', 'Date']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('5.0%')).toBeTruthy();
  });
});
