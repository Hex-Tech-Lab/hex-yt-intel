import { SupabasePersistenceAdapter } from '../lib/adapters/SupabasePersistenceAdapter';

async function verifyKG() {
  const adapter = new SupabasePersistenceAdapter();
  
  const mockAnalysisId = '00000000-0000-0000-0000-000000000000'; // Placeholder
  
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
