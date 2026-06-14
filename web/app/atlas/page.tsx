import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { AtlasClient } from './AtlasClient';

export const dynamic = 'force-dynamic';

export default async function AtlasPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { session } } = await supabase.auth.getSession();
  
  if (!session) {
    redirect('/auth/signin');
  }

  return <AtlasClient />;
}
