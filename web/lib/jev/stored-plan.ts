/**
 * R3b 2.5a (ADR 037 Addendum A): the stored Jev plan (`analyses.jev_plan`)
 * and the single rule for which (jevChunkIndex, chunkIndex) cells an analysis
 * expects. Persist, finalize, projective context, the reaper and the
 * /stream-tokens route all read the plan through this module, so "is this
 * analysis complete?" has one answer everywhere.
 */

import { z } from 'zod';

export const StoredPlanSchema = z.object({
  K: z.number().int().min(1),
  streamCount: z.number().int().min(1),
  truncatedFallback: z.boolean().optional(),
  cells: z.array(z.object({
    jevChunkIndex: z.number().int().min(0),
    chunkIndex: z.number().int().min(1),
    startWord: z.number().int().min(0),
    endWord: z.number().int().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })),
});

export type StoredPlan = z.infer<typeof StoredPlanSchema>;

export interface CellRef {
  jevChunkIndex: number;
  chunkIndex: number;
}

/** The stored plan when it parses, else null (absent and malformed plans are treated alike). */
export function parseStoredPlan(raw: unknown): StoredPlan | null {
  const parsed = StoredPlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The cells an analysis must receive before it can finalize, in ascending
 * (jevChunkIndex, chunkIndex) order.
 *
 * - A valid plan with K > 1: exactly the plan's cells.
 * - Otherwise (no plan, malformed plan, K = 1): today's one cell per bundle,
 *   jevChunkIndex 0, chunkIndex 1..totalStreams. This is what keeps K=1
 *   analyses on the pre-Jev path byte for byte.
 */
export function expectedCells(rawPlan: unknown, totalStreams: number): CellRef[] {
  const plan = parseStoredPlan(rawPlan);
  const cells: CellRef[] = plan && plan.K > 1
    ? plan.cells.map(({ jevChunkIndex, chunkIndex }) => ({ jevChunkIndex, chunkIndex }))
    : Array.from({ length: totalStreams }, (unusedSlot, position): CellRef => {
        void unusedSlot;
        return { jevChunkIndex: 0, chunkIndex: position + 1 };
      });
  return cells.sort((left, right) => left.jevChunkIndex - right.jevChunkIndex || left.chunkIndex - right.chunkIndex);
}

/** Stable key for a cell, e.g. "2:4". */
export function cellKey(cell: CellRef): string {
  return `${cell.jevChunkIndex}:${cell.chunkIndex}`;
}
