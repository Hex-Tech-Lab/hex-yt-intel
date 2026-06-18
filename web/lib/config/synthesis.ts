/**
 * Synthesis configuration and constants.
 */

/**
 * The total number of dimensions (chunks) expected in a full UCIS v2.0 synthesis.
 * This matches the prompt structure in ucis-v5.1.ts.
 */
export const TOTAL_DIMENSIONS = 11;
export const TOTAL_STREAMS = 4;

export const STREAM_BUNDLES: number[][] = [
  [1],
  [2, 4, 6, 8],
  [5, 7, 9, 10],
  [3, 11],
];

/**
 * Whether to abort all parallel streams if a single stream fails.
 * If false, the system attempts to provide a partial synthesis.
 */
export const ABORT_ON_PARTIAL_FAILURE = true;

export interface DimensionConfig {
  number: number;
  name: string;
  extraFields?: ('persona' | 'knowledgeGraph' | 'classification' | 'monetizationVerdict')[];
}

export const DIMENSION_CONFIGS: Record<number, DimensionConfig> = {
  1: { number: 1, name: 'APEX INTELLIGENCE', extraFields: ['persona'] },
  2: { number: 2, name: 'PROVENANCE, METADATA & VIRALITY PROFILE' },
  3: { number: 3, name: 'CONTENT ARCHITECTURE & FIRST PRINCIPLES' },
  4: { number: 4, name: 'PSYCHOLOGICAL & RHETORICAL LAYER' },
  5: { number: 5, name: 'CORE INTELLIGENCE EXTRACTION' },
  6: { number: 6, name: 'COMPARATIVE & QUANTITATIVE ANALYSIS' },
  7: { number: 7, name: 'IMPLEMENTATION SYSTEMS & WORKFLOWS' },
  8: { number: 8, name: 'SEMANTIC & KNOWLEDGE GRAPH FOUNDATION', extraFields: ['knowledgeGraph'] },
  9: { number: 9, name: 'FORWARD INTELLIGENCE & STRATEGIC FORESIGHT' },
  10: { number: 10, name: 'CREDIBILITY, RISK & META-ASSESSMENT' },
  11: { number: 11, name: 'COMMERCIAL YIELD & MONETIZATION PROFILING', extraFields: ['classification', 'monetizationVerdict'] },
};

