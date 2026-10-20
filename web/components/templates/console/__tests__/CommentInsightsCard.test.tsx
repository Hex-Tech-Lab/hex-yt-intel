// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { CommentInsightsCard, formatScopeLine } from '@/components/templates/console/CommentInsightsCard';

const INSIGHTS = {
  population: 1800,
  reportedTotal: 1800,
  sampleSize: 320,
  classified: 318,
  failed: 2,
  lowConfidence: 4,
  marginOfError: 0.054,
  confidence: 0.95,
  marginScope: 'sampled_pool' as const,
  sentiment: { positive: 180, negative: 60, neutral: 60, mixed: 18 },
  types: { question: 40, praise: 20, criticism: 10 },
  painPointCount: 12,
  questionCount: 40,
  costUsd: 0.01,
  model: 'jev',
  completedAt: '2026-09-30T00:00:00.000Z',
};

afterEach(cleanup);

describe('CommentInsightsCard', () => {
  it('renders the exact sampled-pool scope wording', () => {
    render(<CommentInsightsCard insights={INSIGHTS} />);
    expect(screen.getByText(
      'Sampled pool: 320 of 1800 comments fetched (YouTube returns up to ~2,000) · ±5.4% at 95% confidence'
    )).toBeTruthy();
  });

  it('appends the low-confidence exclusion line when lowConfidence > 0', () => {
    render(<CommentInsightsCard insights={INSIGHTS} />);
    expect(screen.getByText(/4 low-confidence classifications excluded/)).toBeTruthy();
  });

  it('omits the low-confidence line when zero', () => {
    render(<CommentInsightsCard insights={{ ...INSIGHTS, lowConfidence: 0 }} />);
    expect(screen.queryByText(/low-confidence classifications excluded/)).toBeNull();
  });

  it('renders top types, pain points and questions chips', () => {
    render(<CommentInsightsCard insights={INSIGHTS} />);
    expect(screen.getByText('question: 40')).toBeTruthy();
    expect(screen.getByText('praise: 20')).toBeTruthy();
    expect(screen.getByText('Pain points: 12')).toBeTruthy();
    expect(screen.getByText('Questions: 40')).toBeTruthy();
  });

  it('renders four sentiment meters with percentage labels', () => {
    render(<CommentInsightsCard insights={INSIGHTS} />);
    for (const label of ['Positive', 'Negative', 'Neutral', 'Mixed']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    const meters = screen.getAllByRole('meter');
    expect(meters).toHaveLength(4);
  });

  it('sentiment percentages are of classified, not of the bucket sum', () => {
    // Buckets sum to 200 but 400 comments were classified: positive 100 -> 25%, not 50%.
    render(<CommentInsightsCard insights={{ ...INSIGHTS, classified: 400, sentiment: { positive: 100, negative: 50, neutral: 30, mixed: 20 } }} />);
    const [positive] = screen.getAllByRole('meter');
    expect(positive?.getAttribute('value')).toBe('25');
  });

  it('formatScopeLine rounds margin to 1dp and confidence to integer', () => {
    expect(formatScopeLine(INSIGHTS)).toContain('±5.4% at 95% confidence');
  });
});
