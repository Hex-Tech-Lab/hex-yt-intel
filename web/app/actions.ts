'use server';

/**
 * Server Actions
 * Pure server-side functions that can be called from Client Components
 * Runs only on the server, never exposes server logic to the client
 */

/**
 * Health check action
 * Returns server status for client-side monitoring
 */
export async function pingAction() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get analysis by ID (future implementation)
 * Example server action that would fetch from database
 */
export async function getAnalysisAction(analysisId: string) {
  // TODO: Implement database lookup
  // const analysis = await supabase.from('analyses').select('*').eq('id', analysisId).single();
  return {
    id: analysisId,
    status: 'pending',
  };
}
