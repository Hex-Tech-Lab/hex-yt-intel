import { NextResponse } from 'next/server';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { AggregateGlobalGraphUseCase } from '@/lib/usecases/AggregateGlobalGraphUseCase';

export async function GET() {
  try {
    const supabase = await getSupabaseClientWithAuth();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ nodes: [], edges: [] }, { status: 401 });
    }

    const persistence = new SupabasePersistenceAdapter();
    const analyses = await persistence.getAnalysesByTenant(user.id);
    
    const useCase = new AggregateGlobalGraphUseCase();
    const globalGraph = await useCase.execute(analyses);

    return NextResponse.json(globalGraph);
  } catch (error) {
    console.error('[atlas/global-graph] Processing error:', error);
    return NextResponse.json({ nodes: [], edges: [] }, { status: 500 });
  }
}
