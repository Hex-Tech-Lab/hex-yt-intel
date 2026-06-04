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
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useRelations } from '@/hooks/useRelations';
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
  const { status, error, videoMetadata, analysisHistory } = useAnalysisStore();
  const { url, setUrl } = useInputStore();
  const { startAnalysis } = useSSEStream();
  const { projection, analysis } = useSynthesisNucleus();
  const { graph } = useKnowledgeGraph();
  const { insights, loading: insightsLoading } = useRelations(analysis?.id ?? null, status === 'complete');
  const [search, setSearch] = useState('');
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  const [consoleTab, setConsoleTab] = useState<'synthesis' | 'graph'>('synthesis');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string | null>(null);

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
  const historyBadge = analysisHistory.length > 0 ? String(analysisHistory.length) : undefined;

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

  const sidebarItems: SidebarItem[] = useMemo(() => [
    { key: 'console', label: 'Synthesis Console', icon: 'solar:graph-up-linear' },
    { key: 'history', label: 'Analysis History', icon: 'solar:folder-with-files-linear', badge: historyBadge },
    { key: 'settings', label: 'Settings', icon: 'solar:settings-linear' },
  ], [historyBadge]);

  const dimensions: Dimension[] = useMemo(() => {
    if (!projection) return [];

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

    return projection.visibleDimensions.map((dim) => {
      const isPending = projection.pendingDimensions.has(dim.number);
      let dimStatus: 'idle' | 'streaming' | 'done' | 'error' = 'idle';
      if (status === 'complete') {
        dimStatus = isPending ? 'idle' : 'done';
      } else if (status === 'analyzing' || status === 'downloading') {
        dimStatus = isPending ? 'idle' : 'streaming';
      } else if (status === 'error') {
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
  }, [projection, status]);

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
          tier={tierLabel}
          account={<div title={profile.email} className="w-8 h-8 rounded-lg bg-[var(--accent)] grid place-items-center text-[var(--void)] font-bold text-xs">{profile.initials}</div>}
        />
      }
      rightPanel={
        status !== 'idle' ? (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <span className="text-[var(--ink-secondary)] font-mono text-[11px] tracking-[0.08em] uppercase">Intelligence</span>
              {graph.nodes.length > 0 && consoleTab === 'synthesis' && (
                <button
                  onClick={() => setConsoleTab('graph')}
                  title="Open full graph"
                  className="flex items-center gap-1.25 px-2.5 py-1 rounded-lg border border-[var(--line)] bg-transparent text-[var(--accent-ink)] cursor-pointer font-mono text-[10.5px]"
                >
                  <Icon icon="solar:maximize-square-linear" size={13} /> expand
                </button>
              )}
            </div>
            {consoleTab === 'synthesis' ? (
              <>
                {graph.nodes.length > 0 ? (
                  <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} compact height={200} />
                ) : (
                  <div className="h-[200px] rounded-2xl border border-dashed border-[var(--line)] grid place-items-center text-center text-[var(--ink-muted)] font-mono text-[10.5px] p-3 leading-relaxed">
                    {status === 'complete' ? 'No relational structure for this analysis.' : 'Synthesizing… the graph populates as dimensions arrive.'}
                  </div>
                )}
                <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} insights={insights} insightsLoading={insightsLoading} />
              </>
            ) : (
              <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} insights={insights} insightsLoading={insightsLoading} />
            )}
          </div>
        ) : undefined
      }
      dock={<ChatDock analysisId={analysis?.id ?? null} analysisTitle={videoMetadata?.title} />}
    >
      {activeNav === 'console' ? (
        <div className="flex flex-col gap-8 pb-4">
          <AnalysisHero
            url={url}
            status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'}
            onUrlChange={setUrl}
            onAnalyze={handleAnalyze}
            error={error?.message}
            quota={quotaLabel}
          />

          {videoMetadata && (
            <BentoMetadata
              title={videoMetadata.title}
              channelTitle={videoMetadata.channelTitle}
              viewCount={videoMetadata.viewCount}
              likeCount={videoMetadata.likeCount}
              duration={videoMetadata.duration || 0}
              publishedAt={videoMetadata.publishedAt}
            />
          )}

          {status !== 'idle' && (
            <>
              <div className="flex gap-1 p-1 rounded-xl border border-[var(--line)] bg-[rgb(11_14_20_/_0.5)] self-start">
                {([
                  { key: 'synthesis', label: 'Synthesis', icon: 'solar:widget-5-linear' },
                  { key: 'graph', label: 'Knowledge Graph', icon: 'solar:share-circle-linear' },
                ] as const).map((t) => {
                  const active = consoleTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setConsoleTab(t.key as 'synthesis' | 'graph')}
                      className={`flex items-center gap-1.75 px-3.5 py-1.75 rounded-lg border-none cursor-pointer font-mono text-xs font-semibold transition-colors ${
                        active ? 'bg-[var(--accent)] text-[var(--void)]' : 'bg-transparent text-[var(--ink-secondary)]'
                      }`}
                    >
                      <Icon icon={t.icon} size={15} />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {consoleTab === 'synthesis' ? (
                <div className="flex flex-col gap-8">
                  {status === 'complete' && <PersonaSelector />}
                  <StreamingGrid
                    dimensions={dimensions}
                    progress={status === 'analyzing' ? 'Processing...' : status === 'complete' ? '100% complete' : undefined}
                    onOpenDimension={(key) => setSelectedDimensionKey(key)}
                  />
                  <ProcessingLog
                    status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'}
                  />
                </div>
              ) : (
                <div>
                  {graph.nodes.length > 0 ? (
                    <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onFocus={setSelectedNodeId} height={580} />
                  ) : (
                    <div className="h-[580px] rounded-2xl border border-dashed border-[var(--line)] grid place-items-center text-center text-[var(--ink-muted)] font-mono text-[12.5px] p-6 leading-relaxed">
                      {status === 'complete' ? 'No graph relations were synthesized for this analysis.' : 'The knowledge graph builds live as dimensions arrive…'}
                    </div>
                  )}
                  <p className="mt-2.5 text-[var(--ink-muted)] font-mono text-[11px] leading-relaxed">
                    Left-click to inspect · right-click to pin &amp; focus · drag to reposition · scroll to zoom
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      ) : activeNav === 'history' ? (
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
