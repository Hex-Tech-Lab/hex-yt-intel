import { LandingPage } from './landing-page';

export const dynamic = 'force-dynamic';

/**
 * ROOT PAGE - PUBLIC LANDING
 * -------------------------
 * This serves the static marketing landing page.
 * It is HARD DE-COUPLED from the Atlas application layer.
 * All Atlas-related redirects and auth checks have been removed.
 */
export default async function RootPage() {
  return <LandingPage />;
}
