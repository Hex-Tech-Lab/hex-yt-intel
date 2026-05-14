import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { Navigation } from '@/components/Navigation';
import { Footer } from '@/components/Footer';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  if (!session) {
    redirect('/auth/signin');
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Top Navigation Bar */}
      <Navigation user={session.user} />

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
