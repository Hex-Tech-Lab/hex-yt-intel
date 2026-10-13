// @vitest-environment happy-dom
// T10: "show more" on the video description toggles aria-expanded and applies the capped-height class.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';

const LONG_DESCRIPTION = 'x'.repeat(200);
const COLLAPSED_CLASS = 'max-h-[var(--description-collapsed-height)]';
const CAPPED_CLASS = 'max-h-[var(--description-max-height)]';

describe('BentoMetadata description show more', () => {
  it('toggles aria-expanded and applies the capped-height class', () => {
    render(
      <BentoMetadata title="T" channelTitle="C" viewCount="2000" likeCount="80" duration={90} publishedAt="2026-01-02T00:00:00Z" description={LONG_DESCRIPTION} />,
    );
    const button = screen.getByRole('button', { name: /show more/i });
    const body = screen.getByTestId('bento-description');

    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(body.className).not.toContain(CAPPED_CLASS);
    // max-height needs a numeric start to animate; line-clamp (max-height: none) would snap.
    expect(body.className).toContain(COLLAPSED_CLASS);

    expect(body.getAttribute('tabindex')).toBeNull();

    fireEvent.click(button);

    expect(screen.getByRole('button', { name: /show less/i }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('bento-description').className).toContain(CAPPED_CLASS);
    // scrollable region must be keyboard-reachable (WCAG 2.1.1)
    expect(screen.getByTestId('bento-description').getAttribute('tabindex')).toBe('0');

    fireEvent.click(screen.getByRole('button', { name: /show less/i }));

    expect(screen.getByRole('button', { name: /show more/i }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('bento-description').className).not.toContain(CAPPED_CLASS);
  });

  it('does not render a toggle for a short description', () => {
    render(
      <BentoMetadata title="T" channelTitle="C" viewCount="2000" likeCount="80" duration={90} publishedAt="2026-01-02T00:00:00Z" description="short" />,
    );
    expect(screen.queryByRole('button', { name: /show more/i })).toBeNull();
  });
});
