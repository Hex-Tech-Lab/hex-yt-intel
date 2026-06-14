'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';

const GlobalKnowledgeMap = dynamic(
  () => import('@/components/organisms/GlobalKnowledgeMap').then((mod) => mod.GlobalKnowledgeMap),
  {
    ssr: false,
    loading: () => <Skeleton />,
  }
);

export default function WikiPage() {
  return (
    <div className="container mx-auto p-4 space-y-6">
      <h1 className="text-2xl font-bold">Macro-Memory Wiki</h1>
      <GlobalKnowledgeMap />
    </div>
  );
}
