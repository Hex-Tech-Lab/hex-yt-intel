/**
 * Real, permanent, version-controlled required-subsections map for the UCIS v5.3
 * parity-test judge harness.
 *
 * SOURCE OF TRUTH: extracted verbatim from `web/lib/prompts/ucis-v5.3.ts`
 * (headers `#### N.M Title` / `#### [NAME]`) on 2026-08-18, re-verified against
 * the live file line-by-line (lines 88-457) while building this harness. This
 * is the file every prior parity-test round grepped ad hoc from source and
 * then let die with the scratch harness — it is now committed here so no
 * future round has to reconstruct it from memory or prose description again.
 *
 * If `ucis-v5.3.ts`'s subsection structure ever changes, this file MUST be
 * updated in the same PR — it is allowed to drift out of sync with source
 * only for the duration of that one commit, never longer.
 */

export const REQUIRED_SUBSECTIONS: Record<number, string[]> = {
  1: ['[EXECUTIVE_SUMMARY]', '[SHORT_SUMMARY]', '[LONG_SUMMARY]'],
  2: [
    '2.1 Header Intelligence',
    '2.2 Engagement & Virality Metrics',
    '2.3 Channel Authority Assessment',
    '2.4 Audience Sentiment Prediction',
  ],
  3: [
    '3.1 Executive Overview',
    '3.2 First Principles Deconstruction',
    '3.3 Temporal Content Map & Arc Analysis',
  ],
  4: [
    '4.1 Sentiment & Tonal Profile',
    '4.2 Persuasion Strategy',
    '4.3 Bias Detection & Critical Assessment',
  ],
  5: ['5.1 Priority Insights Matrix', '5.2 Power Quotes Library', '5.3 Referenced Entities'],
  6: ['6.1 Comparison Tables', '6.2 Scenario Analysis'],
  7: ['7.1 Implementation Systems', '7.2 Execution Sequencing & Dependencies'],
  8: [
    '8.1 Primary Knowledge Graph Nodes',
    '8.2 Semantic Relations',
    '8.3 Cross-Domain Bridges',
    '8.4 Discovery Pathways',
  ],
  9: [
    '9.1 Trend Projections',
    '9.2 Identified Gaps',
    '9.3 Unconventional Tangents & Cross-Domain Applications',
    '9.4 Unfair Advantages (persona-keyed)',
    '9.5 Contrarian Perspectives',
  ],
  10: [
    '10.1 Recommendation Credibility Score',
    '10.2 Domain-Specific Risk Disclosures',
    '10.3 Final Classification',
  ],
  11: [
    '11.1 AdSense RPM & Display Revenue Potential',
    '11.2 Sponsorship & Brand Partnership CPM',
    '11.3 Lead Generation & Service Monetization Value',
    '11.4 Affiliate & E-Commerce Monetization',
    '11.5 Persona-Weighted Monetization Strategy',
    '11.6 Monetization Risk & Sustainability Assessment',
    '11.7 Monetization Verdict (Persona-Weighted Summary)',
  ],
};

/** The real production bundle groupings, `web/lib/config/synthesis.ts` STREAM_BUNDLES. */
export const STREAM_BUNDLES: number[][] = [[1, 10], [8], [2, 4, 6], [5, 7], [3, 9, 11]];

export function requiredSubsectionsForBundle(dims: number[]): string[] {
  return dims.flatMap((d) => (REQUIRED_SUBSECTIONS[d] ?? []).map((s) => `D${d}: ${s}`));
}
