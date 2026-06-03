import { loadConsoleProfile } from '@/lib/services/console-profile';
import { DashboardContainer } from '@/components/containers/DashboardContainer';
import { LandingPage } from './landing-page';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const profile = await loadConsoleProfile();

  if (profile) {
    // Authenticated users see the new Synthesis Console
    return <DashboardContainer profile={profile} />;
  }

  // Unauthenticated users see landing page (replica with Three.js)
  return <LandingPage />;
}
