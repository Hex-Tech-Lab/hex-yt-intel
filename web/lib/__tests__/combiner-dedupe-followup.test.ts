import { describe, expect, it } from 'vitest';
import { CombinerPass } from '@/lib/services/CombinerPass';

describe('Combiner dedupe follow-up negative controls (Tasks 1-6)', () => {
  const mk = (number: number, content: string) => ({ number, content });

  // Task 1: combiner-dedupe.ts:44, :157-163, :266-270 — a repeated claim at two different REAL timestamps must keep BOTH mentions
  it('Task 1: keeps both mentions of a repeated claim at different real timestamps', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\nKey metric reached $10M [12:40]'),
      mk(1, '#### 1.1 Overview\nKey metric reached $10M [47:05]'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toContain('[12:40]');
    expect(out[0].content).toContain('[47:05]');
  });

  it('Task 1: placeholder timestamp is upgraded to real timestamp without keeping both', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\nKey metric reached $10M [timestamp not provided in transcript]'),
      mk(1, '#### 1.1 Overview\nKey metric reached $10M [12:40]'),
    ]);
    expect(out[0].content).toContain('[12:40]');
    expect(out[0].content).not.toContain('timestamp not provided');
    expect(out[0].content.match(/Key metric reached \$10M/g)).toHaveLength(1);
  });

  // Task 2: combiner-dedupe.ts:47 — keep the minus sign for "(-5%)" and unicode minus "−5%"; must not merge with "5%"
  it('Task 2: preserves minus signs for (-5%) and unicode minus −5% and does not merge with 5%', () => {
    const outParen = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\nChurn fell (-5%) in Q2.'),
      mk(1, '#### 1.1 Overview\nChurn fell (5%) in Q2.'),
    ]);
    expect(outParen[0].content).toContain('(-5%)');
    expect(outParen[0].content).toContain('(5%)');

    const outUnicode = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\nChurn fell −5% in Q2.'),
      mk(1, '#### 1.1 Overview\nChurn fell 5% in Q2.'),
    ]);
    expect(outUnicode[0].content).toContain('−5%');
    expect(outUnicode[0].content).toContain('Churn fell 5%');
  });

  // Task 3: matchSubHeader — own-dimension lines like "3.2x growth..." or "1.5-fold ..." are NOT headers
  it('Task 3: own-dimension lines with metric units/suffixes like 3.2x or 1.5-fold are not treated as headers', () => {
    const boldAst = CombinerPass.parseDimensionMarkdown(
      3,
      'D3',
      '#### 3.1 Overview\nIntro.\n\n**3.2x growth in revenue** this year.',
    );
    expect(Array.from(boldAst.subsections.keys())).toEqual(['3.1']);
    expect(boldAst.subsections.get('3.1')?.body).toContain('**3.2x growth in revenue** this year.');

    const plainFoldAst = CombinerPass.parseDimensionMarkdown(
      1,
      'D1',
      '#### 1.1 Overview\nIntro.\n\n1.5-fold increase in retention over baseline.',
    );
    expect(Array.from(plainFoldAst.subsections.keys())).toEqual(['1.1']);
    expect(plainFoldAst.subsections.get('1.1')?.body).toContain('1.5-fold increase');
  });

  it('Task 3b: bold/plain subheaders whose titles merely start with x/fold/percent stay headers', () => {
    const ast = CombinerPass.parseDimensionMarkdown(
      2,
      'D2',
      '**2.1 Xbox adoption** grew\n\n**2.2 Folder sync rollout**\n\n2.3: Percentile ranking',
    );
    expect(Array.from(ast.subsections.keys())).toEqual(['2.1', '2.2', '2.3']);
  });

  // Task 4: CombinerPass.ts:234 — identical-key intros differing only by symbols/timestamps must not drop the second
  it('Task 4: identical-key intros differing by symbols or timestamps do not drop the second intro', () => {
    const outSymbols = CombinerPass.reduceDimensions([
      mk(1, '★★★\n\n#### 1.1 A\nBody A'),
      mk(1, '☆☆☆\n\n#### 1.1 A\nBody B'),
    ]);
    expect(outSymbols[0].content).toContain('★★★');
    expect(outSymbols[0].content).toContain('☆☆☆');

    const outTimestamps = CombinerPass.reduceDimensions([
      mk(1, '[00:12]\n\n#### 1.1 A\nBody A'),
      mk(1, '[05:30]\n\n#### 1.1 A\nBody B'),
    ]);
    expect(outTimestamps[0].content).toContain('[00:12]');
    expect(outTimestamps[0].content).toContain('[05:30]');
  });

  // Task 5: combiner-dedupe.ts:252 — timestamp_upgrade must not overwrite a longer superset block
  it('Task 5: timestamp_upgrade does not overwrite a longer superset block', () => {
    // Block-level case: existing block is superset but has no real timestamp; incoming has real timestamp but is shorter
    const outBlocks = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\n1. Alpha launch happened in March with strong adoption across all segments [timestamp not provided in transcript]\n\n2. Beta program expanded to twelve customers.'),
      mk(1, '#### 1.1 Overview\n1. Alpha launch happened in March [04:15]\n\n2. Beta program expanded to twelve customers.'),
    ]);
    expect(outBlocks[0].content).toContain('with strong adoption across all segments');
    expect(outBlocks[0].content).toContain('[04:15]');

    // Whole-body case: existing body is superset with no real timestamp; incoming is shorter with real timestamp
    const outWholeBody = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\nAlpha launch happened in March with strong adoption across all segments [timestamp not provided in transcript]'),
      mk(1, '#### 1.1 Overview\nAlpha launch happened in March [04:15]'),
    ]);
    expect(outWholeBody[0].content).toContain('with strong adoption across all segments');
    expect(outWholeBody[0].content).toContain('[04:15]');
  });

  // Task 6: Hedges ("(approximate)") must stay part of comparison text
  it('Task 6: hedges like (approximate) stay part of comparison text and do not collapse with precise figures', () => {
    const out = CombinerPass.reduceDimensions([
      mk(1, '#### 1.1 Overview\nRevenue grew 20% (approximate).'),
      mk(1, '#### 1.1 Overview\nRevenue grew 20%.'),
    ]);
    expect(out[0].content).toContain('Revenue grew 20% (approximate).');
    expect(out[0].content).toContain('Revenue grew 20%.');
  });
});
