import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { DashboardShell } from '@/components/DashboardShell';
import { DashboardClient } from '@/components/DashboardClient';
import { LandingPage } from './landing-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    // Authenticated users see DashboardShell (dark design system) — hardwired
    return (
      <DashboardShell user={user}>
        <DashboardClient />
      </DashboardShell>
    );
  }

  // Unauthenticated users see landing page
  return <LandingPage />;
}
