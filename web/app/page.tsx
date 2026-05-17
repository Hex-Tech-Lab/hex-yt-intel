import dynamicImport from 'next/dynamic';

export const dynamic = 'force-dynamic';

const HomeContent = dynamicImport(() => import('@/components/HomeContent'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen flex-col bg-white items-center justify-center">
      <div className="text-center">
        <h1 className="text-3xl font-bold mb-4">Hex-YT-Intel</h1>
        <p className="text-gray-600 mb-2">Loading...</p>
        <div className="animate-spin inline-block">⟳</div>
      </div>
    </div>
  ),
});

export default function Home() {
  return <HomeContent />;
}
