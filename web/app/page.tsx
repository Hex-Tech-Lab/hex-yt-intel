import { default as nextDynamic } from 'next/dynamic';

export const dynamic = 'force-dynamic';

const HomeContent = nextDynamic(() => import('@/components/HomeContent'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen flex-col bg-white items-center justify-center">
      <div className="text-center">
        <p className="text-gray-600 mb-2">Loading...</p>
        <div className="animate-spin inline-block">⟳</div>
      </div>
    </div>
  ),
});

export default function Home() {
  return <HomeContent />;
}
