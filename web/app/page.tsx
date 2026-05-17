import dynamic from 'next/dynamic';
import { Suspense } from 'react';

// Loading fallback component for the home page
function HomeLoading() {
  return (
    <div className="flex h-screen flex-col bg-white items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Hex-YT-Intel</h1>
        <p className="text-gray-600 mb-2">Loading application...</p>
        <div className="animate-spin inline-block">⟳</div>
      </div>
    </div>
  );
}

// Dynamically import the client component - prevents SSR hydration issues
const HomeContent = dynamic(() => import('@/components/HomeContent'), {
  ssr: false,
  loading: () => <HomeLoading />,
});

export default function Home() {
  return (
    <Suspense fallback={<HomeLoading />}>
      <HomeContent />
    </Suspense>
  );
}
