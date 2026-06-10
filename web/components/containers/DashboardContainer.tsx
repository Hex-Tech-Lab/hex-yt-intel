'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import { StreamingGrid, Dimension } from '@/components/templates/console/StreamingGrid';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { ProcessingLog } from '@/components/templates/console/ProcessingLog';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { DimensionDrawer } from '@/components/templates/console/DimensionDrawer';
import { KnowledgeGraphCanvas } from '@/components/templates/console/KnowledgeGraphCanvas';
import { IntelligencePanel } from '@/components/templates/console/IntelligencePanel';
import { ChatDock } from '@/components/templates/console/ChatDock';
import { ApexSummaryCard } from '@/components/templates/console/ApexSummaryCard';
import { RightPanelAccordion } from '@/components/dashboard/RightPanelAccordion';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useRelations } from '@/hooks/useRelations';
import { useChatStore } from '@/store/useChatStore';
import { Icon } from '@/components/templates/_shared/primitives';
import type { ConsoleProfile } from '@/lib/services/console-profile';

// See /docs/ui/dashboard-container.md

export interface DashboardContainerProps {
  profile: ConsoleProfile;
}

function cleanDimensionContent(raw: string): string {
  return (raw || '')
    .replace(/^\s*#{1,6}\s+.*$/gm, '')
    .replace(/^\s*DIMENSION\s+\d+\b.*$/gim, '')
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+(?=\S)/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function DashboardContainer({ profile }: DashboardContainerProps) {
  const store = useAnalysisStore();
  const { url, setUrl } = useInputStore();
  const { startAnalysis } = useSSEStream();
  const nucleus = useSynthesisNucleus();
  const { graph } = useKnowledgeGraph(nucleus.analysis?.id);
  const { insights, loading: insightsLoading } = useRelations(nucleus.analysis?.id ?? null, store.status === 'complete');
  const [search, setSearch] = useState('');
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string | null>(null);

  // Define Right Panel Accordion Items
  const rightPanelItems = useMemo(() => [
    {
      title: 'Insights',
      defaultOpen: true,
      content: (
        <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} insights={insights} insightsLoading={insightsLoading} />
      )
    },
    {
      title: 'Word Cloud',
      content: (
        graph.nodes.length > 0 ? 
        <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} compact height={200} />
        : <div className="p-4 text-center text-[var(--ink-muted)]">No graph structure yet.</div>
      )
    },
    {
      title: 'Mind Map',
      content: (
        graph.nodes.length > 0 ? 
        <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} compact height={200} />
        : <div className="p-4 text-center text-[var(--ink-muted)]">No graph structure yet.</div>
      )
    }
  ], [graph, selectedNodeId, insights, insightsLoading]);

  // Clear the sticky localStorage chat session when starting a new analysis or navigating away
  useEffect(() => {
    if (nucleus.analysis?.id || url) {
      useChatStore.getState().reset();
    }
  }, [nucleus.analysis?.id, url]);

  useEffect(() => {
    if (activeNav !== 'console') {
      setSelectedDimensionKey(null);
    }
  }, [activeNav]);

  const tierLabel = profile.tier === 'pro' ? 'Pro' : profile.tier === 'free' ? 'Free' : profile.tier;
  const quotaLabel =
    profile.monthlyLimit === null
      ? `${profile.analysesUsed} analyses · Unlimited`
      : `${profile.analysesUsed} / ${profile.monthlyLimit} monthly analyses`;
  const historyBadge = store.analysisHistory.length > 0 ? String(store.analysisHistory.length) : undefined;

  const getUserTimezone = (): string => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  };

  const handleAnalyze = useCallback(async () => {
    if (!url) return;
    await startAnalysis(url, getUserTimezone());
  }, [url, startAnalysis]);

  const handleExport = useCallback((format: 'pdf' | 'markdown') => {
    if (!nucleus.analysis?.id) return;
    if (format === 'pdf') {
      window.open(`/api/analyses/${nucleus.analysis.id}/export?format=pdf&scope=full`, '_blank');
    } else {
      const content = store.analysis?.analysis_markdown || '';
      const blob = new Blob([content], { type: 'text/markdown' });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${nucleus.analysis.title || 'synthesis'}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    }
  }, [nucleus.analysis?.id, nucleus.analysis?.title, store.analysis?.analysis_markdown]);

  const sidebarItems: SidebarItem[] = useMemo(() => [
    { key: 'console', label: 'Synthesis Console', icon: 'solar:graph-up-linear' },
    { key: 'history', label: 'Analysis History', icon: 'solar:folder-with-files-linear', badge: historyBadge },
    { key: 'settings', label: 'Settings', icon: 'solar:settings-linear' },
  ], [historyBadge]);

  const dimensions: Dimension[] = useMemo(() => {
    if (!nucleus.projection) return [];

    const DIMENSION_LABELS: Record<number, string> = {
      1: "Apex Intelligence",
      2: "Provenance & Metadata",
      3: "Content Architecture",
      4: "Psychological Layer",
      5: "Core Intelligence",
      6: "Quantitative Analysis",
      7: "Implementation Systems",
      8: "Semantic Foundation",
      9: "Forward Foresight",
      10: "Credibility & Risk",
      11: "Commercial Yield",
    };

    const DIMENSION_ICONS: Record<number, string> = {
      1: "solar:graph-up-linear",
      2: "solar:link-round-angle-linear",
      3: "solar:folder-with-files-linear",
      4: "solar:user-linear",
      5: "solar:bolt-linear",
      6: "solar:magnifer-linear",
      7: "solar:refresh-linear",
      8: "solar:crown-minimalistic-linear",
      9: "solar:graph-up-linear",
      10: "solar:shield-check-linear",
      11: "solar:wad-of-money-linear",
    };

    const DIMENSION_SPANS: Record<number, 1 | 2 | 3> = {
      1: 3, 5: 2, 11: 2
    };

    return nucleus.projection.visibleDimensions.map((dim) => {
      const isPending = nucleus.projection?.pendingDimensions.has(dim.number);
      let dimStatus: 'idle' | 'streaming' | 'done' | 'error' = 'idle';
      if (store.status === 'complete') {
        dimStatus = isPending ? 'idle' : 'done';
      } else if (store.status === 'analyzing' || store.status === 'downloading') {
        dimStatus = isPending ? 'idle' : 'streaming';
      } else if (store.status === 'error') {
        dimStatus = 'error';
      }

      return {
        key: `dim-${dim.number}`,
        label: DIMENSION_LABELS[dim.number] || `Dimension ${dim.number}`,
        icon: DIMENSION_ICONS[dim.number] || "solar:bolt-linear",
        status: dimStatus,
        content: cleanDimensionContent(dim.content),
        span: (DIMENSION_SPANS[dim.number] || 1) as 1 | 2 | 3,
      };
    });
  }, [nucleus.projection, store.status]);

  return (
    <>
    <DashboardLayout
      sidebar={
        <Sidebar
          items={sidebarItems}
          activeKey={activeNav}
          onNavigate={(key) => setActiveNav(key as 'console' | 'history' | 'settings')}
          repoScope={{ label: 'Main Graph', onClick: () => {} }}
        />
      }
      topbar={
        <TopBar
          search={search}
          onSearchChange={setSearch}
          onExport={handleExport}
          tier={tierLabel}
          account={<div title={profile.email} className="w-8 h-8 rounded-lg bg-[var(--accent)] grid place-items-center text-[var(--void)] font-bold text-xs">{profile.initials}</div>}
        />
      }
      rightPanel={
        store.status !== 'idle' ? (
          <RightPanelAccordion items={rightPanelItems} />
        ) : undefined
      }
      dock={<ChatDock analysisId={nucleus.analysis?.id ?? null} analysisTitle={store.videoMetadata?.title} />}
    >
      {activeNav === 'console' ? (
        <div className="flex flex-col gap-8 pb-4">
          <AnalysisHero
            url={url}
            status={store.status === 'analyzing' || store.status === 'downloading' ? 'streaming' : store.status === 'complete' ? 'done' : store.status === 'error' ? 'error' : 'idle'}
            onUrlChange={setUrl}
            onAnalyze={handleAnalyze}
            error={store.error?.message}
            quota={quotaLabel}
          />

          {store.videoMetadata && (
            <BentoMetadata
              title={store.videoMetadata.title}
              channelTitle={store.videoMetadata.channelTitle}
              viewCount={store.videoMetadata.viewCount}
              likeCount={store.videoMetadata.likeCount}
              duration={store.videoMetadata.duration || 0}
              publishedAt={store.videoMetadata.publishedAt}
            />
          )}

          {store.status !== 'idle' && (
            <div className="flex flex-col gap-8">
              {store.status === 'complete' && dimensions.length > 0 && <PersonaSelector />}
              
              {dimensions.length > 0 && (
                <ApexSummaryCard dimension={dimensions[0]!} />
              )}

              {dimensions.length > 1 ? (
                <StreamingGrid
                  dimensions={dimensions.slice(1)}
                  progress={store.status === 'analyzing' ? 'Processing...' : store.status === 'complete' ? '100% complete' : undefined}
                  onOpenDimension={(key) => setSelectedDimensionKey(key)}
                />
              ) : dimensions.length === 0 && (
                <div className="p-12 text-center border border-dashed border-[var(--line)] rounded-2xl bg-[var(--surface-raised)]/30">
                  {store.status === 'complete' ? (
                    <p className="text-[var(--ink-secondary)] font-mono text-sm">No synthesis dimensions were produced for this analysis.</p>
                  ) : store.status === 'error' ? (
                    <p className="text-[var(--danger,#ef4444)] font-mono text-sm">Synthesis failed — see the log below.</p>
                  ) : (
                    <>
                      <Icon icon="solar:refresh-linear" size={32} className="hx-anispin text-[var(--accent)] mb-4 inline-block" />
                      <p className="text-[var(--ink-secondary)] font-mono text-sm">Preparing synthesis dimensions…</p>
                    </>
                  )}
                </div>
              )}
              <ProcessingLog
                status={store.status === 'analyzing' || store.status === 'downloading' ? 'streaming' : store.status === 'complete' ? 'done' : store.status === 'error' ? 'error' : 'idle'}
              />
            </div>
          )}
        </div>
      ) : (activeNav as string) === 'history' ? (
        <AnalysisHistory onSelectAnalysis={() => setActiveNav('console')} />
      ) : (
        <div className="p-12 text-center text-[var(--ink-secondary)]">
          Settings coming soon...
        </div>
      )}

    </DashboardLayout>

      {activeNav === 'console' && (
        <DimensionDrawer
          dimension={
            selectedDimensionKey
              ? dimensions.find(d => d.key === selectedDimensionKey) || null
              : null
          }
          onClose={() => setSelectedDimensionKey(null)}
        />
      )}
    </>
  );
}
