import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { Navigation } from '@/components/organisms/Navigation';
import { Footer } from '@/components/Footer';
import { DashboardClient } from '@/components/DashboardClient';
import { Toaster } from 'react-hot-toast';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

  return (
    <div className="flex flex-col min-h-screen bg-black">
      {/* Top Navigation Bar */}
      <Navigation user={user} />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <DashboardClient />
      </main>

      {/* Footer */}
      <Footer />
      <Toaster position="bottom-right" />
    </div>
  );
}
