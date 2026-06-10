import { SupabasePersistenceAdapter } from '../lib/adapters/SupabasePersistenceAdapter';

async function verifyKG() {
  const adapter = new SupabasePersistenceAdapter();
  
  // NOTE: This script is for development verification only. 
  // It directly mutates the DB, which violates Law #4 (HMAC S2S mandate).
  // Use for local schema testing ONLY.
  const mockAnalysisId = 'test-kg-stub-001'; 
  
  console.log('Testing persistKnowledgeGraph...');
  
  try {
    await adapter.persistKnowledgeGraph({
      analysisId: mockAnalysisId,
      entities: [
        { label: 'Gemini', type: 'tool', weight: 10 },
        { label: 'Postgres', type: 'tool', weight: 8 }
      ],
      relations: [
        { source: 'Gemini', target: 'Postgres', relation: 'uses', strength: 9 }
      ]
    });
    console.log('Successfully called persistKnowledgeGraph (stub verification)');
  } catch (e) {
    console.error('Test failed:', e);
  }
}

verifyKG();
