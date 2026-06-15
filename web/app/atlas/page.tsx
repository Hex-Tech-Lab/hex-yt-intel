import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { AtlasClient } from './AtlasClient';

export const dynamic = 'force-dynamic';

export default async function AtlasPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
  console.log('[AtlasPage] Auth check', { hasSession: !!session, error: sessionError });

  if (!session) {
    console.log('[AtlasPage] No session, redirecting to signin');
    redirect('/auth/signin');
  }

  return <AtlasClient />;
}
