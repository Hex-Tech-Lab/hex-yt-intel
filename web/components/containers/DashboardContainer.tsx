'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import { DimensionAccordion, type Dimension } from '@/components/templates/console/DimensionAccordion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { KnowledgeGraphCanvas } from '@/components/templates/console/KnowledgeGraphCanvas';
import { IntelligencePanel } from '@/components/templates/console/IntelligencePanel';
import { ChatDock } from '@/components/templates/console/ChatDock';
import { RightPanelAccordion } from '@/components/dashboard/RightPanelAccordion';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useRelations } from '@/hooks/useRelations';
import { Icon } from '@/components/templates/_shared/primitives';
import type { ConsoleProfile } from '@/lib/services/console-profile';
import { VideoPlayerCard } from '@/components/templates/console/VideoPlayerCard';
import { ProcessingLog } from '@/components/templates/console/ProcessingLog';

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
  const setUserRole = useAnalysisStore((s) => s.setUserRole);
  const status = useAnalysisStore((s) => s.status);
  const analysisHistory = useAnalysisStore((s) => s.analysisHistory);
  const analysis = useAnalysisStore((s) => s.analysis);
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const error = useAnalysisStore((s) => s.error);
  const terminalLines = useAnalysisStore((s) => s.terminalLines);

  const showLog = status !== 'idle' && terminalLines.length > 0;

  const { url, setUrl } = useInputStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setUserRole(profile.role);
  }, [profile.role, setUserRole]);

  useEffect(() => {
    setMounted(true);
  }, []);
  const { startAnalysis } = useSSEStream();
  const nucleus = useSynthesisNucleus();
  const { graph } = useKnowledgeGraph(nucleus.analysis?.id);
  const { insights, loading: insightsLoading } = useRelations(nucleus.analysis?.id ?? null, status === 'complete');
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

  const handleReanalyze = useCallback(async () => {
    if (!url) return;
    await startAnalysis(url, getUserTimezone(), true);
  }, [url, startAnalysis]);

  const handleExport = useCallback((format: 'pdf' | 'markdown') => {
    if (!nucleus.analysis?.id) return;
    if (format === 'pdf') {
      window.open(`/api/analyses/${nucleus.analysis.id}/export?format=pdf&scope=full`, '_blank');
    } else {
      const content = analysis?.analysis_markdown || '';
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
  }, [nucleus.analysis?.id, nucleus.analysis?.title, analysis?.analysis_markdown]);

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

    const rawReceived = nucleus.analysis?.streaming.dimensionsReceived;
    const receivedList = Array.isArray(rawReceived)
      ? rawReceived.filter((v): v is number => typeof v === 'number')
      : [];

    const visibleDimensionNumbers = nucleus.projection.visibleDimensions.map(d => d.number);
    const visibleReceivedList = receivedList.filter(num => visibleDimensionNumbers.includes(num));
    const lastVisibleReceived = visibleReceivedList.length > 0 ? visibleReceivedList[visibleReceivedList.length - 1] : null;

    return nucleus.projection.visibleDimensions.map((dim) => {
      let dimStatus: 'idle' | 'streaming' | 'done' | 'error' = 'idle';
      
      const isReceived = receivedList.includes(dim.number);

      if (status === 'complete') {
        dimStatus = isReceived ? 'done' : 'idle';
      } else if (status === 'analyzing' || status === 'downloading') {
        if (!isReceived) {
          dimStatus = 'idle';
        } else if (dim.number === lastVisibleReceived) {
          dimStatus = 'streaming';
        } else {
          dimStatus = 'done';
        }
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
  }, [nucleus.projection, status, nucleus.analysis?.streaming.dimensionsReceived]);

  const selectedDimension = useMemo(() => {
    if (!selectedDimensionKey) return null;
    return dimensions.find(d => d.key === selectedDimensionKey) || null;
  }, [selectedDimensionKey, dimensions]);

  // Default selection to first dimension when loaded
  useEffect(() => {
    if (dimensions.length > 0 && !selectedDimensionKey) {
      const firstKey = dimensions[0]?.key;
      if (firstKey) {
        setSelectedDimensionKey(firstKey);
      }
    }
  }, [dimensions, selectedDimensionKey]);

  return (
    <>
      <DashboardLayout
        sidebar={
          <Sidebar
          items={sidebarItems}
          activeKey={activeNav}
          onNavigate={(key) => setActiveNav(key as 'console' | 'history' | 'settings')}
          repoScope={{ label: 'Main Graph', onClick: () => {} }}
        >
          {showLog && (
            <ProcessingLog status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'} />
          )}
        </Sidebar>
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
        status !== 'idle' ? (
          <div className="flex flex-col gap-6 h-full min-h-0 overflow-y-auto hx-custom-scrollbar">
            {selectedDimension && (
              <div className="border border-[var(--line)] rounded-xl bg-[rgb(26_31_43_/_0.3)] p-5 flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--line)]">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--accent)] font-bold">
                      Dimension {dimensions.findIndex(d => d.key === selectedDimensionKey) + 1}
                    </span>
                    <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-[var(--ink)] truncate">
                      {selectedDimension.label}
                    </h3>
                  </div>
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    selectedDimension.status === 'streaming' ? 'bg-[var(--accent)] animate-pulse' :
                    selectedDimension.status === 'done' ? 'bg-[var(--ok)]' :
                    selectedDimension.status === 'error' ? 'bg-[var(--err)]' :
                    'bg-[var(--ink-muted)]'
                  }`} />
                </div>
                
                <div className="flex-1 text-[13px] leading-relaxed text-[var(--ink-secondary)] max-h-[420px] overflow-y-auto pr-1 hx-custom-scrollbar">
                  {selectedDimension.content ? (
                    <div className="prose prose-invert max-w-none text-[12px] leading-relaxed text-[var(--ink-secondary)] prose-p:mb-3.5 prose-p:mt-0 prose-headings:text-[13px] prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2 prose-table:my-4 prose-table:text-[10px] prose-th:px-2 prose-th:py-1.5 prose-td:px-2 prose-td:py-1.5 prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5 prose-li:mb-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedDimension.content}
                      </ReactMarkdown>
                    </div>
                  ) : selectedDimension.status === 'error' ? (
                    <p className="font-mono text-[11px] text-[var(--err)] opacity-80">
                      Synthesis failed for this dimension.
                    </p>
                  ) : (
                    <div className="space-y-3 animate-pulse pt-2">
                      <div className="h-3 bg-[var(--line-strong)] rounded w-3/4 opacity-20" />
                      <div className="h-3 bg-[var(--line-strong)] rounded w-1/2 opacity-15" />
                      <div className="h-3 bg-[var(--line-strong)] rounded w-5/6 opacity-10" />
                    </div>
                  )}
                </div>
              </div>
            )}
            
            <div className="flex-shrink-0">
              <RightPanelAccordion items={rightPanelItems} />
            </div>
          </div>
        ) : undefined
      }
      dock={<ChatDock analysisId={nucleus.analysis?.id ?? null} analysisTitle={videoMetadata?.title} />}
    >
      {activeNav === 'console' ? (
        <div className="flex flex-col gap-8 pb-4">
          <AnalysisHero
            url={mounted ? url : ''}
            status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'}
            onUrlChange={setUrl}
            onAnalyze={handleAnalyze}
            onReanalyze={handleReanalyze}
            error={error?.message}
            quota={quotaLabel}
          />

          {(videoMetadata || nucleus.analysis?.videoId) && (
            <div className="flex flex-col gap-4">
              <VideoPlayerCard />
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
            </div>
          )}

          {status !== 'idle' && (
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
                  {status === 'complete' && dimensions.length > 0 && <PersonaSelector />}
                  
                  {dimensions.length > 0 ? (
                    <DimensionAccordion
                      dimensions={dimensions}
                      selectedDimensionKey={selectedDimensionKey}
                      onSelectDimension={setSelectedDimensionKey}
                      progress={status === 'analyzing' ? 'Processing...' : status === 'complete' ? '100% complete' : undefined}
                    />
                  ) : (
                    <div className="p-12 text-center border border-dashed border-[var(--line)] rounded-2xl bg-[var(--surface-raised)]/30">
                      {status === 'complete' ? (
                        <p className="text-[var(--ink-secondary)] font-mono text-sm">No synthesis dimensions were produced for this analysis.</p>
                      ) : status === 'error' ? (
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
    </>
  );
}
