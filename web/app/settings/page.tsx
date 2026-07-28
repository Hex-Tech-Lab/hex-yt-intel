import { redirect } from 'next/navigation';
import { getSupabaseClientWithAuth } from '@/lib/supabase';
import { SettingsPanel } from '@/components/containers/dashboard/SettingsPanel';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/auth/signin');
  }

  return <SettingsPanel initialSubmenu="overview" />;
}
