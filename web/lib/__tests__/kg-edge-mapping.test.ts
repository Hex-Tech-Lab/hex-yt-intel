import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AggregateGlobalGraphUseCase } from '@/lib/usecases/AggregateGlobalGraphUseCase';
import { DeduplicateGraphUseCase } from '@/lib/usecases/DeduplicateGraphUseCase';
import type { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';
import type { GraphPersistencePort } from '@/lib/ports/GraphPersistencePort';
import type { VectorDedupPort, DedupResult } from '@/lib/ports/VectorDedupPort';

describe('Knowledge Graph Edge Mapping Bug Fix', () => {
  describe('AggregateGlobalGraphUseCase: Node ID Keying', () => {
    let useCase: AggregateGlobalGraphUseCase;

    beforeEach(() => {
      useCase = new AggregateGlobalGraphUseCase();
    });

    it('TC-1: Should key nodes by ID, not by label', () => {
      const node1: GraphNode = {
        id: 'node-1',
        label: 'climate change',
        dimension: 0,
        content: 'discusses global warming',
        weight: 1,
        polarity: 0,
        keyTerms: ['warming', 'carbon'],
        inPersona: false
      };

      const node2: GraphNode = {
        id: 'node-2',
        label: 'climate change',
        dimension: 1,
        content: 'discusses weather patterns',
        weight: 2,
        polarity: 0,
        keyTerms: ['weather', 'precipitation'],
        inPersona: false
      };

      const graph = useCase.execute([
        { id: 'analysis-1', nodes: [node1], edges: [] },
        { id: 'analysis-2', nodes: [node2], edges: [] }
      ]);

      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.map(n => n.id).sort()).toEqual(['node-1', 'node-2']);
    });

    it('TC-2: Should deduplicate nodes with same ID across analyses', () => {
      const node1: GraphNode = {
        id: 'node-shared',
        label: 'machine learning',
        dimension: 0,
        content: 'content 1',
        weight: 1,
        polarity: 0,
        keyTerms: ['ML', 'AI'],
        inPersona: false
      };

      const node2: GraphNode = {
        id: 'node-shared',
        label: 'machine learning',
        dimension: 0,
        content: 'content 2',
        weight: 2,
        polarity: 0,
        keyTerms: ['neural', 'deep'],
        inPersona: false
      };

      const graph = useCase.execute([
        { id: 'analysis-1', nodes: [node1], edges: [] },
        { id: 'analysis-2', nodes: [node2], edges: [] }
      ]);

      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0].id).toBe('node-shared');
      expect(graph.nodes[0].weight).toBe(3);
    });

    it('TC-3: Should preserve edges that reference valid node IDs', () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'label1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n2', label: 'label2', dimension: 0, content: 'c2', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const validEdge: GraphEdge = {
        source: 'n1',
        target: 'n2',
        strength: 0.8,
        kind: 'related'
      };

      const graph = useCase.execute([
        { id: 'analysis-1', nodes, edges: [validEdge] }
      ]);

      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toEqual(validEdge);
    });

    it('TC-4: Should filter out edges with missing source node', () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'label1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const orphanedEdge: GraphEdge = {
        source: 'missing-node-id',
        target: 'n1',
        strength: 0.8,
        kind: 'related'
      };

      const graph = useCase.execute([
        { id: 'analysis-1', nodes, edges: [orphanedEdge] }
      ]);

      expect(graph.edges).toHaveLength(0);
    });

    it('TC-5: Should filter out edges with missing target node', () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'label1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const orphanedEdge: GraphEdge = {
        source: 'n1',
        target: 'missing-node-id',
        strength: 0.8,
        kind: 'related'
      };

      const graph = useCase.execute([
        { id: 'analysis-1', nodes, edges: [orphanedEdge] }
      ]);

      expect(graph.edges).toHaveLength(0);
    });

    it('TC-6: Should filter both orphaned edges in mixed scenario', () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n2', label: 'l2', dimension: 0, content: 'c2', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n3', label: 'l3', dimension: 0, content: 'c3', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const edges: GraphEdge[] = [
        { source: 'n1', target: 'n2', strength: 0.8, kind: 'related' },
        { source: 'n2', target: 'missing', strength: 0.7, kind: 'similar' },
        { source: 'missing', target: 'n3', strength: 0.6, kind: 'tangent' },
        { source: 'n3', target: 'n1', strength: 0.9, kind: 'contrarian' }
      ];

      const graph = useCase.execute([
        { id: 'analysis-1', nodes, edges }
      ]);

      expect(graph.edges).toHaveLength(2);
    });

    it('TC-7: Should handle edge deduplication by kind', () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n2', label: 'l2', dimension: 0, content: 'c2', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const edges: GraphEdge[] = [
        { source: 'n1', target: 'n2', strength: 0.7, kind: 'related' },
        { source: 'n1', target: 'n2', strength: 0.9, kind: 'related' },
        { source: 'n1', target: 'n2', strength: 0.5, kind: 'similar' }
      ];

      const graph = useCase.execute([
        { id: 'analysis-1', nodes, edges }
      ]);

      expect(graph.edges).toHaveLength(2);
    });

    it('TC-8: Should handle cross-analysis edge references', () => {
      const analysis1Nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n2', label: 'l2', dimension: 0, content: 'c2', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const analysis2Nodes: GraphNode[] = [
        { id: 'n3', label: 'l3', dimension: 1, content: 'c3', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      const edges: GraphEdge[] = [
        { source: 'n1', target: 'n2', strength: 0.8, kind: 'related' },
        { source: 'n2', target: 'n3', strength: 0.7, kind: 'similar' }
      ];

      const graph = useCase.execute([
        { id: 'analysis-1', nodes: analysis1Nodes, edges: edges.slice(0, 1) },
        { id: 'analysis-2', nodes: analysis2Nodes, edges: edges.slice(1) }
      ]);

      expect(graph.edges).toHaveLength(2);
      expect(graph.nodes).toHaveLength(3);
    });
  });

  describe('DeduplicateGraphUseCase: Cascading Edge Deletion', () => {
    let useCase: DeduplicateGraphUseCase;
    let mockGraphPort: GraphPersistencePort;
    let mockVectorPort: VectorDedupPort;

    beforeEach(() => {
      mockGraphPort = {
        persistKnowledgeGraph: vi.fn(),
        getKnowledgeGraph: vi.fn(),
        getAnalysesByTenant: vi.fn(),
        persistGraph: vi.fn(),
        getGraph: vi.fn(),
        cascadeDeleteEdges: vi.fn().mockResolvedValue(0)
      };

      mockVectorPort = {
        markStale: vi.fn().mockResolvedValue({ count: 0 }),
        deduplicateNodes: vi.fn()
      };

      useCase = new DeduplicateGraphUseCase(mockGraphPort, mockVectorPort);
    });

    it('TC-9: Should cascade delete edges when nodes are deduplicated', async () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n2', label: 'l2', dimension: 0, content: 'c2', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      vi.mocked(mockGraphPort.getGraph).mockResolvedValueOnce({
        nodes,
        relations: [{ source: 'n1', target: 'n2', strength: 0.8, kind: 'related' }]
      });

      const dedupResult: DedupResult = {
        success: true,
        deletedCount: 1,
        deletedNodeIds: ['n2']
      };

      vi.mocked(mockVectorPort.deduplicateNodes).mockResolvedValueOnce(dedupResult);
      vi.mocked(mockGraphPort.cascadeDeleteEdges).mockResolvedValueOnce(1);

      await useCase.execute('tenant-1', 'analysis-1');

      expect(mockGraphPort.cascadeDeleteEdges).toHaveBeenCalledWith('analysis-1', ['n2']);
    });

    it('TC-10: Should NOT call cascade delete if no nodes deleted', async () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      vi.mocked(mockGraphPort.getGraph).mockResolvedValueOnce({
        nodes,
        relations: []
      });

      const dedupResult: DedupResult = {
        success: true,
        deletedCount: 0,
        deletedNodeIds: []
      };

      vi.mocked(mockVectorPort.deduplicateNodes).mockResolvedValueOnce(dedupResult);

      await useCase.execute('tenant-1', 'analysis-1');

      expect(mockGraphPort.cascadeDeleteEdges).not.toHaveBeenCalled();
    });

    it('TC-11: Should handle multiple deleted nodes', async () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n2', label: 'l2', dimension: 0, content: 'c2', weight: 1, polarity: 0, keyTerms: [], inPersona: false },
        { id: 'n3', label: 'l3', dimension: 0, content: 'c3', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      vi.mocked(mockGraphPort.getGraph).mockResolvedValueOnce({
        nodes,
        relations: []
      });

      const dedupResult: DedupResult = {
        success: true,
        deletedCount: 2,
        deletedNodeIds: ['n2', 'n3']
      };

      vi.mocked(mockVectorPort.deduplicateNodes).mockResolvedValueOnce(dedupResult);
      vi.mocked(mockGraphPort.cascadeDeleteEdges).mockResolvedValueOnce(5);

      await useCase.execute('tenant-1', 'analysis-1');

      expect(mockGraphPort.cascadeDeleteEdges).toHaveBeenCalledWith('analysis-1', ['n2', 'n3']);
    });

    it('TC-12: Should handle deduplication failure gracefully', async () => {
      const nodes: GraphNode[] = [
        { id: 'n1', label: 'l1', dimension: 0, content: 'c1', weight: 1, polarity: 0, keyTerms: [], inPersona: false }
      ];

      vi.mocked(mockGraphPort.getGraph).mockResolvedValueOnce({
        nodes,
        relations: []
      });

      const dedupResult: DedupResult = {
        success: false,
        deletedCount: 0,
        deletedNodeIds: [],
        error: 'Vector index connection failed'
      };

      vi.mocked(mockVectorPort.deduplicateNodes).mockResolvedValueOnce(dedupResult);

      await useCase.execute('tenant-1', 'analysis-1');

      expect(mockGraphPort.cascadeDeleteEdges).not.toHaveBeenCalled();
    });

    it('TC-13: Should handle empty graph gracefully', async () => {
      vi.mocked(mockGraphPort.getGraph).mockResolvedValueOnce(null);

      await useCase.execute('tenant-1', 'analysis-1');

      expect(mockVectorPort.markStale).not.toHaveBeenCalled();
      expect(mockVectorPort.deduplicateNodes).not.toHaveBeenCalled();
      expect(mockGraphPort.cascadeDeleteEdges).not.toHaveBeenCalled();
    });

    it('TC-14: Should handle graph with no nodes gracefully', async () => {
      vi.mocked(mockGraphPort.getGraph).mockResolvedValueOnce({
        nodes: [],
        relations: []
      });

      await useCase.execute('tenant-1', 'analysis-1');

      expect(mockVectorPort.markStale).not.toHaveBeenCalled();
      expect(mockVectorPort.deduplicateNodes).not.toHaveBeenCalled();
      expect(mockGraphPort.cascadeDeleteEdges).not.toHaveBeenCalled();
    });
  });

  describe('Edge Orphan Detection: Integration', () => {
    it('TC-15: Complex scenario with mixed valid and orphaned edges', () => {
      const useCase = new AggregateGlobalGraphUseCase();

      const analysis1 = {
        id: 'a1',
        nodes: [
          { id: 'a1-n1', label: 'ml', dimension: 0, content: 'ML', weight: 2, polarity: 0, keyTerms: ['algo'], inPersona: false },
          { id: 'a1-n2', label: 'dl', dimension: 0, content: 'DL', weight: 1.5, polarity: 0, keyTerms: ['neural'], inPersona: false }
        ],
        edges: [
          { source: 'a1-n1', target: 'a1-n2', strength: 0.85, kind: 'similar' as const },
          { source: 'a1-n2', target: 'orphan', strength: 0.7, kind: 'related' as const }
        ]
      };

      const analysis2 = {
        id: 'a2',
        nodes: [
          { id: 'a2-n1', label: 'ds', dimension: 1, content: 'DS', weight: 1.8, polarity: 0, keyTerms: ['stats'], inPersona: false }
        ],
        edges: [
          { source: 'a2-n1', target: 'a1-n1', strength: 0.75, kind: 'related' as const },
          { source: 'missing', target: 'a2-n1', strength: 0.5, kind: 'tangent' as const }
        ]
      };

      const analysis3 = {
        id: 'a3',
        nodes: [
          { id: 'a3-n1', label: 'ai', dimension: 2, content: 'AI', weight: 2.2, polarity: 0, keyTerms: ['intel'], inPersona: false }
        ],
        edges: [
          { source: 'a3-n1', target: 'a1-n1', strength: 0.8, kind: 'similar' as const }
        ]
      };

      const graph = useCase.execute([analysis1, analysis2, analysis3]);

      expect(graph.nodes).toHaveLength(4);
      expect(graph.edges).toHaveLength(3);
    });
  });
});
