/**
 * S1–S6 structural taxonomy (v1, user-approved 2026-10-03).
 *
 * Codified verbatim from docs/architecture/S1_S6_TAXONOMY.md — descriptions
 * ONLY. Action parameters (chunk sizes, diarization toggles) are NOT here:
 * when Phase B is built they become `analysis.layer0.*` Settings Registry
 * keys (no-hardcoded-tunables), never constants.
 *
 * `JEV_STRUCTURAL_CRITERIA` is the keyed criteria record in the verified
 * Decisions API shape (see worker/src/services/JevCommentClassifier.ts:63 —
 * `choice` questions take a criteria RECORD; a choices array or legend object
 * is rejected with HTTP 400). Shapes verified against the live API on
 * 2026-09-30; the record shape only, not the original POC wording (lost —
 * see taxonomy doc Provenance).
 */

export const STRUCTURAL_CLASSES = [
  'S1_monologue_direct',
  'S2_interview_qa',
  'S3_panel_multi_speaker',
  'S4_procedural_screen_share',
  'S5_narrative_documentary',
  'S6_unstructured_vlog',
] as const;

export type StructuralClass = (typeof STRUCTURAL_CLASSES)[number];

export const CLASS_CODE_BY_ID: Record<StructuralClass, 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6'> = {
  S1_monologue_direct: 'S1',
  S2_interview_qa: 'S2',
  S3_panel_multi_speaker: 'S3',
  S4_procedural_screen_share: 'S4',
  S5_narrative_documentary: 'S5',
  S6_unstructured_vlog: 'S6',
};

export const CLASS_ID_BY_CODE: Record<'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6', StructuralClass> = {
  S1: 'S1_monologue_direct',
  S2: 'S2_interview_qa',
  S3: 'S3_panel_multi_speaker',
  S4: 'S4_procedural_screen_share',
  S5: 'S5_narrative_documentary',
  S6: 'S6_unstructured_vlog',
};

export const JEV_STRUCTURAL_CRITERIA: Record<StructuralClass, string> = {
  S1_monologue_direct: 'One primary speaker presenting directly to the audience',
  S2_interview_qa: 'Two distinct speakers with clear turn-taking',
  S3_panel_multi_speaker: 'Highly dynamic, overlapping dialogue among multiple speakers',
  S4_procedural_screen_share: 'Highly sequential step-by-step how-to demonstration',
  S5_narrative_documentary: 'Heavily edited voiceovers mixed with ambient clips',
  S6_unstructured_vlog: 'Stream of consciousness with high noise-to-signal ratio',
};
