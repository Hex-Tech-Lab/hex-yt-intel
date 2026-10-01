/**
 * MintCellTokensUseCase (R3b 2.3.5c, ADR 037 Addendum A — approved 2026-10-01).
 *
 * Mints one v2 stream token per requested map-reduce cell, deriving EVERY
 * signed field from the stored plan (`analyses.jev_plan`), never from the
 * caller: the request only names cells by (jevChunkIndex, chunkIndex). Tokens
 * are minted per dispatch wave so each carries a fresh 120 s expiry.
 *
 * Pure domain logic: the signer is injected, so the use case has no I/O.
 */

import { z } from 'zod';

const StoredPlanSchema = z.object({
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

export interface CellRef {
  jevChunkIndex: number;
  chunkIndex: number;
}

export interface MintedCellToken extends CellRef {
  sig: string;
  exp: number;
  tokenVersion: 2;
  streamCount: number;
  jevChunkCount: number;
  bundleList: number[][];
  sliceSha256: string;
  startWord: number;
  endWord: number;
}

export interface SignV2Params {
  videoId: string;
  analysisId: string;
  models: string[];
  streamCount: number;
  jevChunkIndex: number;
  jevChunkCount: number;
  chunkIndex: number;
  bundleList: number[][];
  slice: { sha256: string; startWord: number; endWord: number };
}

export type MintCellTokensResult =
  | { type: 'ok'; tokens: MintedCellToken[] }
  | { type: 'no_plan' }
  | { type: 'invalid_plan' }
  | { type: 'plan_k1' }
  | { type: 'plan_truncated' }
  | { type: 'duplicate_cell'; cell: CellRef }
  | { type: 'unknown_cell'; cell: CellRef };

export interface MintCellTokensInput {
  analysisId: string;
  videoId: string;
  models: string[];
  bundleList: number[][];
  storedPlan: unknown;
  cells: CellRef[];
}

const cellKey = (cell: CellRef) => `${cell.jevChunkIndex}:${cell.chunkIndex}`;

export async function mintCellTokens(
  input: MintCellTokensInput,
  sign: (params: SignV2Params) => Promise<{ sig: string; exp: number }>,
): Promise<MintCellTokensResult> {
  if (input.storedPlan === null || input.storedPlan === undefined) return { type: 'no_plan' };
  const parsed = StoredPlanSchema.safeParse(input.storedPlan);
  if (!parsed.success) return { type: 'invalid_plan' };
  const plan = parsed.data;
  // K=1 keeps today's single v1 token; per-cell v2 tokens exist only for K>1.
  if (plan.K === 1) return { type: 'plan_k1' };
  // truncatedFallback is still only a flag (real truncation is a separate
  // prerequisite), so a flagged plan must not be dispatched as K>1.
  if (plan.truncatedFallback) return { type: 'plan_truncated' };

  const planCells = new Map(plan.cells.map((cell) => [cellKey(cell), cell]));
  const seen = new Set<string>();
  for (const cell of input.cells) {
    const key = cellKey(cell);
    if (seen.has(key)) return { type: 'duplicate_cell', cell };
    seen.add(key);
    if (!planCells.has(key)) return { type: 'unknown_cell', cell };
  }

  const tokens: MintedCellToken[] = [];
  for (const requested of input.cells) {
    const cell = planCells.get(cellKey(requested))!;
    const { sig, exp } = await sign({
      videoId: input.videoId,
      analysisId: input.analysisId,
      models: input.models,
      streamCount: plan.streamCount,
      jevChunkIndex: cell.jevChunkIndex,
      jevChunkCount: plan.K,
      chunkIndex: cell.chunkIndex,
      bundleList: input.bundleList,
      slice: { sha256: cell.sha256, startWord: cell.startWord, endWord: cell.endWord },
    });
    tokens.push({
      jevChunkIndex: cell.jevChunkIndex,
      chunkIndex: cell.chunkIndex,
      sig,
      exp,
      tokenVersion: 2,
      streamCount: plan.streamCount,
      jevChunkCount: plan.K,
      bundleList: input.bundleList,
      sliceSha256: cell.sha256,
      startWord: cell.startWord,
      endWord: cell.endWord,
    });
  }
  return { type: 'ok', tokens };
}
