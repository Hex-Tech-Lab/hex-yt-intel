import { redirect } from 'next/navigation';
import { loadConsoleProfile } from '@/lib/services/console-profile';
import { DashboardContainer } from '@/components/containers/DashboardContainer';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const profile = await loadConsoleProfile();

  if (!profile) {
    redirect('/auth/signin');
  }

  // /dashboard is an alias for the Synthesis Console (landing CTAs + nav link
  // point here); the root route serves the same console to authenticated users.
  return <DashboardContainer profile={profile} />;
}
