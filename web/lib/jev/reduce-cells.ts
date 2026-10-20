/**
 * R3b 2.5c (ADR 037 Addendum A5): turn a K>1 analysis's CELL rows into one
 * row per bundle, so the existing per-bundle completeness + stitch finalize
 * (persist route, reaper) runs unchanged.
 *
 * Pure. For each bundle (chunkIndex) in the stored plan:
 * - every expected cell of the bundle must be terminal (completed or failed),
 *   else the bundle is omitted — the caller's existing "not fully received"
 *   logic then waits exactly as it does today for a missing bundle row;
 * - completed cells with a usable `dimensions` array are reduced with
 *   reduceGroundedChunks (weight = the cell's word span from the plan);
 *   the bundle row is 'completed' with the reduced dimensions on top of the
 *   lowest-jev cell's payload;
 * - no usable completed cell → a 'failed' bundle row (same accounting as a
 *   failed bundle today).
 * Dimensions the reducer marks partial are returned for validation_report.
 */

import { reduceGroundedChunks } from '@/lib/services/reduce-grounded-chunks';
import { parseStoredPlan } from '@/lib/jev/stored-plan';
import type { UCISDimension } from '@/lib/types/dimension';

type CellStatus = 'completed' | 'failed' | 'interrupted';

export interface CellRow {
  jev_chunk_index: number;
  chunk_index: number;
  dimensions_covered: number[];
  payload: Record<string, unknown>;
  status: CellStatus;
  updated_at: string | null;
  tokens_used?: number;
  cost_usd?: number;
}

export type BundleRow = Omit<CellRow, 'jev_chunk_index'>;

export interface ReducedBundles {
  rows: BundleRow[];
  /** Dimension numbers missing from at least one expected chunk of their bundle. Ascending. */
  partialDimensions: number[];
}

function usableDimensions(payload: Record<string, unknown>): UCISDimension[] | null {
  const dimensions = payload?.dimensions;
  return Array.isArray(dimensions) ? (dimensions as UCISDimension[]) : null;
}

function latest(values: Array<string | null>): string | null {
  return values.reduce<string | null>((max, value) => (value !== null && (max === null || value > max) ? value : max), null);
}

export function reduceCellsToBundleRows(rawPlan: unknown, cells: readonly CellRow[]): ReducedBundles {
  const plan = parseStoredPlan(rawPlan);
  if (!plan || plan.K <= 1) return { rows: [], partialDimensions: [] };

  const rows: BundleRow[] = [];
  const partial = new Set<number>();
  const bundleIndexes = [...new Set(plan.cells.map((cell) => cell.chunkIndex))].sort((left, right) => left - right);

  for (const chunkIndex of bundleIndexes) {
    const expected = plan.cells.filter((cell) => cell.chunkIndex === chunkIndex);
    const received = expected.map((planCell) => ({
      planCell,
      row: cells.find((row) => row.chunk_index === chunkIndex && row.jev_chunk_index === planCell.jevChunkIndex),
    }));
    if (received.some(({ row }) => !row || row.status === 'interrupted')) continue;

    const usable = received
      .filter(({ row }) => row?.status === 'completed' && usableDimensions(row.payload) !== null)
      .sort((left, right) => left.planCell.jevChunkIndex - right.planCell.jevChunkIndex);
    const terminalRows = received.map(({ row }) => row as CellRow);
    const accounting = {
      chunk_index: chunkIndex,
      updated_at: latest(terminalRows.map((row) => row.updated_at)),
      tokens_used: terminalRows.reduce((sum, row) => sum + (row.tokens_used ?? 0), 0),
      cost_usd: terminalRows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0),
    };

    const firstUsable = usable[0];
    if (!firstUsable?.row) {
      rows.push({ ...accounting, dimensions_covered: [], payload: {}, status: 'failed' });
      continue;
    }

    const reduced = reduceGroundedChunks(
      usable.map(({ planCell, row }) => ({
        jevChunkIndex: planCell.jevChunkIndex,
        wordCount: Math.max(0, planCell.endWord - planCell.startWord),
        dimensions: usableDimensions((row as CellRow).payload) ?? [],
      })),
      { expectedJevChunkCount: expected.length },
    );
    reduced.partial.forEach((dimensionNumber) => partial.add(dimensionNumber));
    rows.push({
      ...accounting,
      dimensions_covered: reduced.dimensions.map((dimension) => dimension.number),
      payload: { ...firstUsable.row.payload, dimensions: reduced.dimensions },
      status: 'completed',
    });
  }

  return { rows, partialDimensions: [...partial].sort((left, right) => left - right) };
}

/**
 * R3b 2.5d: for consumers that must not keep waiting (the reaper's salvage,
 * projective context), every expected cell is settled: a missing or
 * interrupted cell counts as failed, so its bundle reduces from whatever
 * completed. Rows outside the plan's expected set are dropped.
 */
export function settleCellsForSalvage(rawPlan: unknown, cells: readonly CellRow[]): CellRow[] {
  const plan = parseStoredPlan(rawPlan);
  if (!plan) return [];
  return plan.cells.map((planCell) => {
    const row = cells.find((cell) => cell.jev_chunk_index === planCell.jevChunkIndex && cell.chunk_index === planCell.chunkIndex);
    if (row && row.status !== 'interrupted') return row;
    return {
      jev_chunk_index: planCell.jevChunkIndex,
      chunk_index: planCell.chunkIndex,
      dimensions_covered: [],
      payload: {},
      status: 'failed' as const,
      updated_at: row?.updated_at ?? null,
      tokens_used: row?.tokens_used,
      cost_usd: row?.cost_usd,
    };
  });
}
