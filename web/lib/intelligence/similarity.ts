/**
 * SimilarityEngine — pluggable port for dimension similarity.
 *
 * The KnowledgeGraphSynthesizer depends only on this interface, so the lexical
 * TF-IDF engine (zero-infra, ships today) can be swapped for an Upstash Vector /
 * embeddings adapter (true semantic similarity + cross-analysis recall) without
 * touching graph construction. Isomorphic: runs in the browser and the worker.
 */

export interface SimilarityResult {
  /** N×N symmetric cosine matrix, indices aligned to the input doc order. */
  matrix: number[][];
  /** Top distinctive terms per doc (by TF-IDF weight), aligned to input order. */
  keyTerms: string[][];
}

export interface SimilarityEngine {
  /** Compute pairwise similarity over an ordered list of documents. */
  compute(docs: string[]): SimilarityResult | Promise<SimilarityResult>;
}

// --- TF-IDF lexical engine -------------------------------------------------

// Compact English stopword set — enough to keep TF-IDF focused on content terms.
const STOPWORDS = new Set(
  (
    'a an and are as at be by for from has have he in is it its of on that the to ' +
    'was were will with this these those they them their there here what which who ' +
    'whom whose how why when where can could should would may might must shall do ' +
    'does did done not no nor so than too very just also about into over under more ' +
    'most some such only own same other another each any all both few then once you ' +
    'your we our us i me my they it he she his her him out up down off above below ' +
    'or but if because while during before after between through against being been ' +
    'having had get got make made one two three first second new like via per within'
  ).split(/\s+/)
);

/**
 * Tokenize → lowercase words ≥3 chars, no stopwords, light plural trim.
 */
function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
  return raw.map((t) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t));
}

export class TfIdfSimilarityEngine implements SimilarityEngine {
  /** How many distinctive terms to surface per document. */
  private topTerms: number;

  constructor(topTerms = 6) {
    this.topTerms = topTerms;
  }

  compute(docs: string[]): SimilarityResult {
    const n = docs.length;
    const tokenized = docs.map(tokenize);

    // Document frequency per term
    const df = new Map<string, number>();
    for (const tokens of tokenized) {
      for (const term of new Set(tokens)) {
        df.set(term, (df.get(term) || 0) + 1);
      }
    }

    // TF-IDF vector per doc (sparse map) + key-term ranking
    const vectors: Array<Map<string, number>> = [];
    const keyTerms: string[][] = [];

    for (const tokens of tokenized) {
      const tf = new Map<string, number>();
      for (const term of tokens) tf.set(term, (tf.get(term) || 0) + 1);

      const vec = new Map<string, number>();
      const len = tokens.length || 1;
      for (const [term, count] of tf) {
        // idf with +1 smoothing; log-scaled tf
        const idf = Math.log((n + 1) / ((df.get(term) || 0) + 1)) + 1;
        const weight = (count / len) * idf;
        vec.set(term, weight);
      }
      vectors.push(vec);

      const ranked = [...vec.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, this.topTerms)
        .map(([term]) => term);
      keyTerms.push(ranked);
    }

    // Pairwise cosine
    const matrix: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const norms = vectors.map((v) => Math.sqrt([...v.values()].reduce((s, w) => s + w * w, 0)) || 1);

    for (let i = 0; i < n; i++) {
      const vi = vectors[i]!;
      const ni = norms[i]!;
      const rowI = matrix[i]!;
      rowI[i] = 1;
      for (let j = i + 1; j < n; j++) {
        const vj = vectors[j]!;
        const nj = norms[j]!;
        const small = vi.size < vj.size ? vi : vj;
        const large = vi.size < vj.size ? vj : vi;
        let dot = 0;
        for (const [term, w] of small) {
          const w2 = large.get(term);
          if (w2) dot += w * w2;
        }
        const cos = dot / (ni * nj);
        rowI[j] = cos;
        matrix[j]![i] = cos;
      }
    }

    return { matrix, keyTerms };
  }
}
