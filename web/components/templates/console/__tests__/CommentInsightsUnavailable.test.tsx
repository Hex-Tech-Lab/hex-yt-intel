// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { CommentInsightsUnavailable } from '@/components/templates/console/CommentInsightsCard';

afterEach(cleanup);

describe('CommentInsightsUnavailable (T12 designed empty state)', () => {
  it('states a reason when no sentiment run exists, instead of rendering nothing', () => {
    render(<CommentInsightsUnavailable state="none" />);
    const section = screen.getByRole('status', { name: 'Comment insights' });
    expect(section).toHaveTextContent(/Comment sentiment isn't ready/);
  });

  it('states a failed-run reason when the run failed', () => {
    render(<CommentInsightsUnavailable state="failed" />);
    expect(screen.getByRole('status', { name: 'Comment insights' })).toHaveTextContent(/Comment sentiment failed/);
  });

  it('negative control: the empty state is not the populated card (no meters rendered)', () => {
    render(<CommentInsightsUnavailable state="none" />);
    expect(screen.queryByRole('meter')).toBeNull();
  });
});

describe('CommentInsightsUnavailable analyzing state', () => {
  it('shows the analyzing message, not the not-ready one', () => {
    render(<CommentInsightsUnavailable state="analyzing" />);
    const el = screen.getByRole('status', { name: 'Comment insights' });
    expect(el).toHaveTextContent(/Analyzing sentiment/);
    expect(el).not.toHaveTextContent(/isn't ready/);
  });
});
