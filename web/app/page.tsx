import { loadConsoleProfile } from '@/lib/services/console-profile';
import { DashboardContainer } from '@/components/containers/DashboardContainer';
import { LandingPage } from './landing-page';

export const dynamic = 'force-dynamic';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const profile = await loadConsoleProfile();
  const params = await searchParams;
  const forceLanding = params.v === 'landing';

  if (profile && !forceLanding) {
    // Authenticated users see the new Synthesis Console unless landing is forced
    return <DashboardContainer profile={profile} />;
  }

  // Unauthenticated users (or forced) see landing page
  return <LandingPage />;
}
