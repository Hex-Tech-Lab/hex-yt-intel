import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth } from '@/lib/supabase';

export default async function DashboardPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

  redirect('/(dashboard)');
}
