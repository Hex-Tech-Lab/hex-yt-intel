'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/templates/_shared/primitives';
import { Skeleton } from '@/components/ui/skeleton';
import { useSSEStream } from '@/hooks/useSSEStream';

// Lazy load the GlobalKnowledgeMap component
const GlobalKnowledgeMap = dynamic(
  () => import('@/components/organisms/GlobalKnowledgeMap').then(mod => mod.GlobalKnowledgeMap),
  { ssr: false, loading: () => <Skeleton className="absolute inset-0" /> }
);

export default function AtlasPage() {
  const router = useRouter();
  const [videoUrl, setVideoUrl] = useState('');
  const { startAnalysis } = useSSEStream();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!videoUrl.trim()) return;

    setIsSubmitting(true);
    try {
      // Use the analysis pipeline properly via the hook
      await startAnalysis(videoUrl, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
      router.push('/dashboard');
    } catch (error) {
      console.error("[ATLAS_INGESTION_ERROR]:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[var(--void)]">
      {/* Full-bleed background map */}
      <div className="absolute inset-0 opacity-20">
        <GlobalKnowledgeMap />
      </div>

      {/* Hero Content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-10">
        <div className="max-w-2xl w-full flex flex-col items-center text-center">
          <div className="mb-8 p-3 rounded-2xl bg-[rgba(0,242,254,0.05)] border border-[rgba(0,242,254,0.2)]">
             <Icon icon="solar:globus-linear" size={48} className="text-[var(--accent)]" />
          </div>
          
          <h1 className="text-5xl font-bold text-[var(--ink)] mb-4 tracking-tight">
            The Atlas
          </h1>
          <p className="text-xl text-[var(--ink-secondary)] mb-10 max-w-lg">
            Map your knowledge. Visualize connections across your YouTube synthesis.
          </p>

          <form onSubmit={handleAnalyze} className="w-full max-w-lg flex items-center gap-2 p-2 bg-[var(--surface-raised)] border border-[var(--line)] rounded-xl shadow-2xl">
            <input
              type="text"
              placeholder="Paste YouTube video URL..."
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              disabled={isSubmitting}
              className="flex-1 bg-transparent border-none p-3 text-[var(--ink)] placeholder-[var(--ink-muted)] outline-none font-mono text-sm"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-3 bg-[var(--accent)] text-[var(--void)] rounded-lg font-mono text-sm font-bold hover:opacity-90 transition-opacity"
            >
              {isSubmitting ? "Processing..." : "Analyze"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
