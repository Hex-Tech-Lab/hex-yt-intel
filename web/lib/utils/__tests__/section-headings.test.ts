import { describe, it, expect } from 'vitest';
import { promoteSectionHeadings } from '../section-headings';

describe('promoteSectionHeadings', () => {
  it('turns an inline "N.N Title: body" line into a heading plus paragraph', () => {
    expect(promoteSectionHeadings('3.1 Executive Overview: The speaker walks through it.')).toBe(
      '#### 3.1 Executive Overview\n\nThe speaker walks through it.',
    );
  });

  it('handles several sections and a bolded label', () => {
    const input = '8.1 Primary Nodes: 15 nodes.\n\n**8.2 Semantic Relations**: 19 edges.';
    expect(promoteSectionHeadings(input)).toBe(
      '#### 8.1 Primary Nodes\n\n15 nodes.\n\n#### 8.2 Semantic Relations\n\n19 edges.',
    );
  });

  it('leaves prose that merely starts with a decimal alone', () => {
    const prose = '3.5 million users: that is the claim.';
    expect(promoteSectionHeadings(prose)).toBe(prose);
  });

  it('skips fenced code and table rows', () => {
    const input = '```\n3.1 Title: code\n```\n| 3.1 Title: cell |';
    expect(promoteSectionHeadings(input)).toBe(input);
  });
});

describe('promoteSectionHeadings – label on its own line', () => {
  it('promotes "3.1 Title:" with the body on the next line', () => {
    expect(promoteSectionHeadings('3.1 Executive Overview:\nBody text.')).toBe('#### 3.1 Executive Overview\nBody text.');
  });
});
