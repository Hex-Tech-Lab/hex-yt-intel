import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';
import type { GraphNode, GraphEdge } from '@/lib/types/knowledge-graph';

export class SupabaseGraphAdapter {
  static async getAnalysesByTenant(tenantId: string): Promise<Array<{ id: string; title: string; nodes: GraphNode[]; edges: GraphEdge[] }>> {
    try {
      const service = getSupabaseServiceClient();
      const { data, error } = await service
        .from('analyses')
        .select(`
          id, 
          title, 
          nodes:analysis_payload->knowledgeGraph->nodes, 
          edges:analysis_payload->knowledgeGraph->edges
        `)
        .eq('user_id', tenantId);

      if (error) {
        console.error('[SupabaseGraphAdapter] getAnalysesByTenant failed:', error.message);
        throw error;
      }
      
      return (data || []).map(row => {
        return {
          id: row.id,
          title: row.title || 'Untitled Analysis',
          nodes: (row.nodes as unknown as GraphNode[]) || [],
          edges: (row.edges as unknown as GraphEdge[]) || []
        };
      });
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getAnalysesByTenant' },
        extra: { tenantId },
      });
      throw error;
    }
  }

  static async persistKnowledgeGraph(params: {
    analysisId: string;
    entities: Array<{
      label: string;
      type: string;
      weight: number;
      rawNode?: any;
    }>;
    relations: Array<{
      source: string;
      target: string;
      relation: string;
      strength: number;
      rawEdge?: any;
    }>;
  }): Promise<void> {
    const service = getSupabaseServiceClient();

    // Delete existing for clean slate
    const { error: deleteError } = await service
      .from('kg_entities')
      .delete()
      .eq('analysis_id', params.analysisId);

    if (deleteError) throw deleteError;

    // Insert entities
    const { data: entityRows, error: entityError } = await service
      .from('kg_entities')
      .insert(params.entities.map(e => ({
        analysis_id: params.analysisId,
        label: e.label,
        type: e.type,
        weight: e.weight,
        raw_node: e.rawNode ?? null
      })))
      .select('id, label');

    if (entityError) throw entityError;

    // Map label to ID
    const labelToId = new Map(entityRows.map(r => [r.label, r.id]));

    // Insert relations
    const relationRows = params.relations.map(r => ({
      analysis_id: params.analysisId,
      source_entity_id: labelToId.get(r.source),
      target_entity_id: labelToId.get(r.target),
      relation_label: r.relation,
      strength: r.strength,
      raw_edge: r.rawEdge ?? null
    })).filter(r => r.source_entity_id && r.target_entity_id);

    if (relationRows.length > 0) {
      const { error: relationError } = await service
        .from('kg_relations')
        .insert(relationRows);
      
      if (relationError) throw relationError;
    }
  }

  static async getKnowledgeGraph(analysisId: string): Promise<{
    entities: Array<{ id: string; label: string; type: string; weight: number; raw_node?: any }>;
    relations: Array<{ source_entity_id: string; target_entity_id: string; relation_label: string; strength: number; raw_edge?: any }>;
  } | null> {
    try {
      const service = getSupabaseServiceClient();

      const [entities, relations] = await Promise.all([
        service.from('kg_entities').select('id, label, type, weight, raw_node').eq('analysis_id', analysisId),
        service.from('kg_relations').select('source_entity_id, target_entity_id, relation_label, strength, raw_edge').eq('analysis_id', analysisId)
      ]);

      const resultsMap = {
        ERROR: (err: any) => { throw err; },
        SUCCESS: (data: any) => data || [],
      };

      const firstError = entities.error || relations.error;
      if (firstError) resultsMap.ERROR(firstError);

      return {
        entities: resultsMap.SUCCESS(entities.data),
        relations: resultsMap.SUCCESS(relations.data),
      };
    } catch (error: unknown) {
      Sentry.captureException(error, {
        tags: { method: 'getKnowledgeGraph' },
        extra: { analysisId },
      });
      throw error;
    }
  }

}
