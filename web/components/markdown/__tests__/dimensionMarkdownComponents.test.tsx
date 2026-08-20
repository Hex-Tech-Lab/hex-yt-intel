// @vitest-environment happy-dom
//
// Real-render proof for the shared `MarkdownLink` override (extraction of
// the duplicated `link` override from SelectedDimensionReadout.tsx and
// ApexSummaryCard.tsx -- docs/TECH_DEBT_LEDGER.md item 2). Renders both
// consumer components with real markdown content containing a `#t=` link
// and an external `http(s)` link, matching the RTL pattern established in
// web/lib/__tests__/TimestampLink.test.tsx.
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectedDimensionReadout } from '@/components/dashboard/SelectedDimensionReadout';
import { ApexSummaryCard } from '@/components/templates/console/ApexSummaryCard';
import { MarkdownLink } from '@/components/markdown/dimensionMarkdownComponents';
import { useVideoStore } from '@/store/useVideoStore';

const MARKDOWN_WITH_LINKS =
  '#### [EXECUTIVE_SUMMARY]\n\nSee [00:30](#t=30), [external site](https://example.com/docs), and [dashboard](/dashboard).\n';

describe('shared MarkdownLink override', () => {
  beforeEach(() => {
    useVideoStore.setState({ isPlaying: false, seekTo: null });
  });

  describe('SelectedDimensionReadout', () => {
    it('routes #t= links through TimestampLink (real click seeks the store)', () => {
      render(
        <SelectedDimensionReadout
          dimension={{ label: 'Test', icon: 'solar:case-linear', content: MARKDOWN_WITH_LINKS }}
        />
      );
      const seekLink = screen.getByRole('link', { name: /seek to 30/i });
      expect(seekLink).toBeInTheDocument();
      fireEvent.click(seekLink);
      expect(useVideoStore.getState().seekTo).toBe(30);
    });

    it('opens genuinely external http(s) links in a new tab, not #t= or relative links', () => {
      render(
        <SelectedDimensionReadout
          dimension={{ label: 'Test', icon: 'solar:case-linear', content: MARKDOWN_WITH_LINKS }}
        />
      );
      const externalLink = screen.getByRole('link', { name: 'external site' });
      expect(externalLink).toHaveAttribute('target', '_blank');
      expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');

      const seekLink = screen.getByRole('link', { name: /seek to 30/i });
      expect(seekLink).not.toHaveAttribute('target', '_blank');

      const relativeLink = screen.getByRole('link', { name: 'dashboard' });
      expect(relativeLink).not.toHaveAttribute('target', '_blank');
    });
  });

  describe('ApexSummaryCard', () => {
    it('routes #t= links through TimestampLink (real click seeks the store)', () => {
      render(
        <ApexSummaryCard
          dimension={{ key: 'd0', label: 'Apex', icon: 'solar:case-linear', status: 'done', content: MARKDOWN_WITH_LINKS }}
        />
      );
      const seekLink = screen.getByRole('link', { name: /seek to 30/i });
      expect(seekLink).toBeInTheDocument();
      fireEvent.click(seekLink);
      expect(useVideoStore.getState().seekTo).toBe(30);
    });

    it('opens genuinely external http(s) links in a new tab', () => {
      render(
        <ApexSummaryCard
          dimension={{ key: 'd0', label: 'Apex', icon: 'solar:case-linear', status: 'done', content: MARKDOWN_WITH_LINKS }}
        />
      );
      const externalLink = screen.getByRole('link', { name: 'external site' });
      expect(externalLink).toHaveAttribute('target', '_blank');
      expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  // Real gap fix (automated review, PR #260): the two tests above only ever
  // exercised #t= and https:// -- the full external/internal decision matrix
  // was never actually asserted. Exercises MarkdownLink directly so every
  // URL class is covered precisely, not just the two happy-path forms.
  describe('MarkdownLink URL-class matrix', () => {
    it('treats protocol-relative URLs as external', () => {
      render(<MarkdownLink href="//example.com/docs">proto-relative</MarkdownLink>);
      const link = screen.getByRole('link', { name: 'proto-relative' });
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('does not treat a relative path as external', () => {
      render(<MarkdownLink href="/dashboard">relative</MarkdownLink>);
      const link = screen.getByRole('link', { name: 'relative' });
      expect(link).not.toHaveAttribute('target');
      expect(link).not.toHaveAttribute('rel');
    });

    it('does not treat a mailto link as external', () => {
      render(<MarkdownLink href="mailto:test@example.com">email</MarkdownLink>);
      const link = screen.getByRole('link', { name: 'email' });
      expect(link).not.toHaveAttribute('target');
      expect(link).not.toHaveAttribute('rel');
    });

    it('does not treat an in-page anchor as external', () => {
      render(<MarkdownLink href="#section">anchor</MarkdownLink>);
      const link = screen.getByRole('link', { name: 'anchor' });
      expect(link).not.toHaveAttribute('target');
      expect(link).not.toHaveAttribute('rel');
    });
  });
});
