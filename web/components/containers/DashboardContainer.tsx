'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import { StreamingGrid, Dimension } from '@/components/templates/console/StreamingGrid';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    store.setUserRole(profile.role);
  }, [profile.role, store.setUserRole]);

  useEffect(() => {
    setMounted(true);
  }, []);
  const { startAnalysis } = useSSEStream();
  const nucleus = useSynthesisNucleus();
  const { graph } = useKnowledgeGraph(nucleus.analysis?.id);
  const { insights, loading: insightsLoading } = useRelations(nucleus.analysis?.id ?? null, store.status === 'complete');
  const [search, setSearch] = useState('');
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string | null>(null);
  const [consoleTab, setConsoleTab] = useState<'synthesis' | 'graph'>('synthesis');

  // Define Right Panel Accordion Items
  const rightPanelItems = useMemo(() => [
    {
      id: 'insights',
      title: 'Insights',
      defaultOpen: true,
      content: (
        <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} insights={insights} insightsLoading={insightsLoading} />
      )
    },
    {
      id: 'word-cloud',
      title: 'Word Cloud',
      content: (
        graph.nodes.length > 0 ? (
          <div className="flex flex-wrap gap-2 p-3 justify-center items-center max-h-[200px] overflow-y-auto hx-custom-scrollbar bg-[var(--bg)]/40 rounded-xl border border-[var(--line-faint)]">
            {graph.nodes
              .slice()
              .sort((a, b) => b.weight - a.weight)
              .map((node) => {
                const fontSize = Math.max(10, Math.min(22, 9 + node.weight * 1.3));
                const opacity = Math.max(0.4, Math.min(1.0, 0.3 + node.weight * 0.07));
                return (
                  <span
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    className={`cursor-pointer font-mono font-bold tracking-tight transition-all duration-150 hover:text-[var(--accent)] hover:scale-105 ${
                      selectedNodeId === node.id ? 'text-[var(--accent)] underline decoration-2 underline-offset-4' : 'text-[var(--ink-secondary)]'
                    }`}
                    style={{ fontSize: `${fontSize}px`, opacity }}
                  >
                    {node.label}
                  </span>
                );
              })}
          </div>
        ) : (
          <div className="p-4 text-center text-[var(--ink-muted)]">No graph structure yet.</div>
        )
      )
    },
    {
      id: 'mind-map',
      title: 'Mind Map',
      content: (
        graph.nodes.length > 0 ? (
          <div className="p-3 bg-[var(--bg)]/40 rounded-xl border border-[var(--line-faint)] max-h-[220px] overflow-y-auto hx-custom-scrollbar font-mono text-[11px] text-[var(--ink-secondary)]">
            {(() => {
              const root = graph.nodes.reduce((max, node) => node.weight > max.weight ? node : max, graph.nodes[0]!);
              const connectedNodeIds = new Set(
                graph.edges
                  .filter(e => e.source === root.id || e.target === root.id)
                  .map(e => e.source === root.id ? e.target : e.source)
              );
              const level1Nodes = graph.nodes.filter(n => connectedNodeIds.has(n.id) && n.id !== root.id);
              
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-1.5 font-bold text-[var(--accent-ink)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                    <span>{root.label}</span>
                  </div>
                  <div className="pl-3 border-l border-[var(--line)] space-y-2">
                    {level1Nodes.map((child) => {
                      const subConnectedIds = new Set(
                        graph.edges
                          .filter(e => e.source === child.id || e.target === child.id)
                          .map(e => e.source === child.id ? e.target : e.source)
                      );
                      const level2Nodes = graph.nodes
                        .filter(n => subConnectedIds.has(n.id) && n.id !== root.id && n.id !== child.id)
                        .slice(0, 3);
                      
                      return (
                        <div key={child.id} className="space-y-0.5">
                          <div
                            onClick={() => setSelectedNodeId(child.id)}
                            className={`cursor-pointer hover:text-[var(--accent)] transition-colors font-semibold flex items-center gap-1 ${
                              selectedNodeId === child.id ? 'text-[var(--accent)]' : 'text-[var(--ink)]'
                            }`}
                          >
                            <span>↳</span>
                            <span>{child.label}</span>
                          </div>
                          {level2Nodes.length > 0 && (
                            <div className="pl-4 border-l border-[var(--line-strong)]/30 space-y-0.5 text-[9px] text-[var(--ink-muted)]">
                              {level2Nodes.map(subNode => (
                                <div
                                  key={subNode.id}
                                  onClick={() => setSelectedNodeId(subNode.id)}
                                  className={`cursor-pointer hover:text-[var(--accent)] transition-colors ${
                                    selectedNodeId === subNode.id ? 'text-[var(--accent)]' : ''
                                  }`}
                                >
                                  • {subNode.label}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (
          <div className="p-4 text-center text-[var(--ink-muted)]">No mind map structure yet.</div>
        )
      )
    }
  ], [graph, selectedNodeId, insights, insightsLoading]);



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

  const handleReanalyze = useCallback(async () => {
    if (!url) return;
    await startAnalysis(url, getUserTimezone(), true);
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
            url={mounted ? url : ''}
            status={store.status === 'analyzing' || store.status === 'downloading' ? 'streaming' : store.status === 'complete' ? 'done' : store.status === 'error' ? 'error' : 'idle'}
            onUrlChange={setUrl}
            onAnalyze={handleAnalyze}
            onReanalyze={handleReanalyze}
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
              {/* Tab bar: Synthesis grid vs. Knowledge Graph */}
              <div className="flex gap-1 p-1 rounded-xl border border-[var(--line)] bg-[rgb(11_14_20_/_0.5)] self-start">
                {([
                  { key: 'synthesis', label: 'Synthesis', icon: 'solar:widget-5-linear', disabled: false },
                  { key: 'graph', label: 'Knowledge Graph', icon: 'solar:share-circle-linear', disabled: graph.nodes.length === 0 },
                ] as const).map((t) => {
                  const active = consoleTab === t.key;
                  const disabled = t.disabled;
                  return (
                    <button
                      key={t.key}
                      disabled={disabled}
                      onClick={() => setConsoleTab(t.key)}
                      title={disabled ? 'Available once dimensions are synthesized' : undefined}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border-none cursor-pointer font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${
                        active ? 'bg-[var(--accent)] text-[var(--void)] shadow-lg' : 'bg-transparent text-[var(--ink-muted)] hover:text-[var(--ink-secondary)]'
                      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <Icon icon={t.icon} size={14} />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {consoleTab === 'synthesis' ? (
                <>
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
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
                    <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onFocus={setSelectedNodeId} height={520} />
                  </div>
                  <p className="text-[var(--ink-muted)] font-mono text-[10px] uppercase tracking-wider pl-1">
                    Left-click node to inspect · drag to pan/reposition · scroll to zoom
                  </p>
                </div>
              )}

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
