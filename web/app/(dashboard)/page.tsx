import { getServerSession } from 'next-auth';
import { DashboardClient } from '@/components/DashboardClient';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  await getServerSession();

  return <DashboardClient />;
}
