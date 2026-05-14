import { getServerSession } from 'next-auth';
import { DashboardClient } from '@/components/DashboardClient';

export default async function DashboardPage() {
  await getServerSession();

  return <DashboardClient />;
}
