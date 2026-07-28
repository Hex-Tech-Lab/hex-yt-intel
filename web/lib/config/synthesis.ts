/**
 * Synthesis configuration and constants.
 */

/**
 * The total number of CORE dimensions (1-11).
 * Dimension 0 (Executive Digest) is synthesized from these 11 and is NOT counted in TOTAL_DIMENSIONS.
 * This value should NEVER be hard-coded — it comes from admin_settings.
 * TODO: Load from admin_settings table via settings context.
 */
export const TOTAL_DIMENSIONS = 11;
export const TOTAL_STREAMS = 5;

/**
 * Minimum derived dimensions for an analysis to count as "usable". Single source
 * of truth shared by the cache read path (below this a cached row is a miss) and
 * the reaper (below this a stuck row is failed rather than salvaged), so the two
 * never disagree on the same analysis state.
 */
export const MIN_USABLE_DIMENSIONS = 8;

export const STREAM_BUNDLES: number[][] = [
  [1, 10],         // Apex & Credibility
  [8],             // Semantic / KG (large, has knowledgeGraph)
  [2, 4, 6],       // Provenance, Psychological, Comparative
  [5, 7],          // CoreIntel & Implementation
  [3, 9, 11],      // Architecture, Forward, Monetization (has classification + monetization)
];

/**
 * Whether to abort all parallel streams if a single stream fails.
 * If false, the system attempts to provide a partial synthesis.
 */
export const ABORT_ON_PARTIAL_FAILURE = true;

export interface DimensionConfig {
  number: number;
  name: string;
  label: string;
  icon: string;
  span: 1 | 2 | 3;
  extraFields?: ('persona' | 'knowledgeGraph' | 'classification' | 'monetizationVerdict')[];
}

export const DIMENSION_CONFIGS: Record<number, DimensionConfig> = {
  0: { number: 0, name: 'EXECUTIVE DIGEST', label: 'Executive Digest', icon: 'solar:document-text-linear', span: 3 },
  1: { number: 1, name: 'APEX INTELLIGENCE', label: 'Apex Intelligence', icon: 'solar:stars-minimalistic-linear', span: 3, extraFields: ['persona'] },
  2: { number: 2, name: 'PROVENANCE, METADATA & VIRALITY PROFILE', label: 'Provenance & Metadata', icon: 'solar:link-round-angle-linear', span: 1 },
  3: { number: 3, name: 'CONTENT ARCHITECTURE & FIRST PRINCIPLES', label: 'Content Architecture', icon: 'solar:folder-with-files-linear', span: 1 },
  4: { number: 4, name: 'PSYCHOLOGICAL & RHETORICAL LAYER', label: 'Psychological Layer', icon: 'solar:user-linear', span: 1 },
  5: { number: 5, name: 'CORE INTELLIGENCE EXTRACTION', label: 'Core Intelligence', icon: 'solar:bolt-linear', span: 2 },
  6: { number: 6, name: 'COMPARATIVE & QUANTITATIVE ANALYSIS', label: 'Quantitative Analysis', icon: 'solar:chart-2-linear', span: 1 },
  7: { number: 7, name: 'IMPLEMENTATION SYSTEMS & WORKFLOWS', label: 'Implementation Systems', icon: 'solar:refresh-linear', span: 1 },
  8: { number: 8, name: 'SEMANTIC & KNOWLEDGE GRAPH FOUNDATION', label: 'Semantic Foundation', icon: 'solar:share-circle-linear', span: 1, extraFields: ['knowledgeGraph'] },
  9: { number: 9, name: 'FORWARD INTELLIGENCE & STRATEGIC FORESIGHT', label: 'Forward Foresight', icon: 'solar:graph-up-linear', span: 1 },
  10: { number: 10, name: 'CREDIBILITY, RISK & META-ASSESSMENT', label: 'Credibility & Risk', icon: 'solar:shield-check-linear', span: 1 },
  11: { number: 11, name: 'COMMERCIAL YIELD & MONETIZATION PROFILING', label: 'Commercial Yield', icon: 'solar:wad-of-money-linear', span: 2, extraFields: ['classification', 'monetizationVerdict'] },
};

