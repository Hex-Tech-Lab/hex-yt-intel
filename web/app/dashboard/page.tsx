import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { DashboardShell } from '@/components/DashboardShell';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

  return (
    <DashboardShell user={user}>
      <DashboardClient />
    </DashboardShell>
  );
}
