/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AnalysisHero } from '../AnalysisHero';

// Polyfill window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('AnalysisHero UX improvements', () => {
  const defaultProps = {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    status: 'idle' as const,
    onUrlChange: vi.fn(),
    onAnalyze: vi.fn(),
    onReanalyze: vi.fn(),
    onCancel: vi.fn(),
    onDismissError: vi.fn(),
    quota: '10/10',
    isRepeat: false,
  };

  it('renders persistent error banner when status="error" and error message is provided', () => {
    render(
      <AnalysisHero
        {...defaultProps}
        status="error"
        error="Unable to fetch video transcript: rate limit exceeded"
      />
    );

    const banner = screen.getByTestId('hero-error-banner');
    expect(banner).toBeDefined();

    const alertSpan = screen.getByRole('alert');
    expect(alertSpan.textContent).toBe('Unable to fetch video transcript: rate limit exceeded');
    expect(alertSpan.id).toBe('hero-error');
  });

  it('dismisses error banner when user clicks dismiss button and calls onDismissError callback', () => {
    const onDismissError = vi.fn();
    render(
      <AnalysisHero
        {...defaultProps}
        status="error"
        error="Invalid video ID format"
        onDismissError={onDismissError}
      />
    );

    const dismissBtn = screen.getByLabelText('Dismiss error');
    expect(dismissBtn).toBeDefined();

    fireEvent.click(dismissBtn);

    expect(onDismissError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('hero-error-banner')).toBeNull();
  });

  it('re-displays error banner when a new error prop arrives after dismissal', () => {
    const { rerender } = render(
      <AnalysisHero
        {...defaultProps}
        status="error"
        error="First error"
      />
    );

    const dismissBtn = screen.getByLabelText('Dismiss error');
    fireEvent.click(dismissBtn);
    expect(screen.queryByTestId('hero-error-banner')).toBeNull();

    rerender(
      <AnalysisHero
        {...defaultProps}
        status="error"
        error="Second distinct error"
      />
    );

    expect(screen.getByTestId('hero-error-banner')).toBeDefined();
    expect(screen.getByRole('alert').textContent).toBe('Second distinct error');
  });

  it('renders "Analyze" button when isRepeat is false and calls onAnalyze on click', () => {
    const onAnalyze = vi.fn();
    const onReanalyze = vi.fn();
    render(
      <AnalysisHero
        {...defaultProps}
        isRepeat={false}
        onAnalyze={onAnalyze}
        onReanalyze={onReanalyze}
      />
    );

    const button = screen.getByRole('button', { name: /Analyze/i });
    expect(button.textContent).toContain('Analyze');
    expect(button.textContent).not.toContain('Re-analyze');

    fireEvent.click(button);
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    expect(onReanalyze).not.toHaveBeenCalled();
  });

  it('renders "Re-analyze" button when isRepeat is true and calls onReanalyze on click', () => {
    const onAnalyze = vi.fn();
    const onReanalyze = vi.fn();
    render(
      <AnalysisHero
        {...defaultProps}
        isRepeat={true}
        onAnalyze={onAnalyze}
        onReanalyze={onReanalyze}
      />
    );

    const button = screen.getByRole('button', { name: /Re-analyze/i });
    expect(button.textContent).toContain('Re-analyze');

    fireEvent.click(button);
    expect(onReanalyze).toHaveBeenCalledTimes(1);
    expect(onAnalyze).not.toHaveBeenCalled();
  });
});
