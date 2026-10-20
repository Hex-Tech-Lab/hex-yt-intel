/**
 * Grounded Extraction Types & Generation Contract (ADR 039 / Epistemic Schism Part A)
 *
 * Strict, sterile data extraction contract that reads raw video transcripts and
 * outputs a deterministic JSON intermediate representation.
 *
 * Rules:
 * 1. ZERO projective reasoning, speculation, or strategic synthesis.
 * 2. Every atomic claim MUST map to a verbatim quote and real timestamp range [start, end].
 * 3. Any query or evidence not explicitly asserted in the source audio MUST be emitted
 *    to the explicit `unknowns[]` array.
 */

export interface ExtractedClaim {
  id: string; // e.g., "claim_01"
  speaker?: string;
  timestampRange: [number, number]; // [startSeconds, endSeconds]
  verbatimQuote: string;
  atomicAssertion: string;
  confidence: number; // 0.0 to 1.0
}

export interface GroundedExtractionMetadata {
  speakerCount: number;
  durationSeconds: number;
  classification: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';
}

export interface GroundedExtractionPayload {
  claims: ExtractedClaim[];
  unknowns: string[]; // Explicitly unsupported queries or missing evidence
  metadata: GroundedExtractionMetadata;
}
