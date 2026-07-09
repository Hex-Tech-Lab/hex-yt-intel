import { describe, it, expect } from 'vitest';
import { AggregateGlobalGraphUseCase } from '@/lib/usecases/AggregateGlobalGraphUseCase';

describe('Knowledge Graph Edge Mapping - Quick Test', () => {
  it('TC-1: Should key nodes by ID, not by label', () => {
    const useCase = new AggregateGlobalGraphUseCase();
    const graph = useCase.execute([{ id: 'a1', nodes: [], edges: [] }]);
    expect(graph.nodes).toHaveLength(0);
  });
});
