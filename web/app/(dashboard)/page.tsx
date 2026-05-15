import { getServerSession } from 'next-auth';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

// Force rebuild: clear Vercel cache
export default async function DashboardPage() {
  await getServerSession();

  return <DashboardClient />;
}
