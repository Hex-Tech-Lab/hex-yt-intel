'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import { DimensionAccordion, type Dimension } from '@/components/templates/console/DimensionAccordion';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { KnowledgeGraphCanvas } from '@/components/templates/console/KnowledgeGraphCanvas';
import { IntelligencePanel } from '@/components/templates/console/IntelligencePanel';
import { ChatDock } from '@/components/templates/console/ChatDock';
import { RightPanelAccordion } from '@/components/dashboard/RightPanelAccordion';
import { WordCloud } from '@/components/templates/console/WordCloud';
import { MindMap } from '@/components/templates/console/MindMap';
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
import { DimensionDrawer } from '@/components/templates/console/DimensionDrawer';

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
  const supabase = createClient();
  const router = useRouter();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  const { startAnalysis, stopAnalysis } = useSSEStream();
  const nucleus = useSynthesisNucleus();
  const { graph } = useKnowledgeGraph(nucleus.analysis?.id);
  const { insights, loading: insightsLoading } = useRelations(nucleus.analysis?.id ?? null, status === 'complete');
  const [search, setSearch] = useState('');
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string | null>(null);
  const [consoleTab, setConsoleTab] = useState<'synthesis' | 'graph'>('synthesis');

  const [expandedPanel, setExpandedPanel] = useState<{
    id: 'insights' | 'knowledge-graph' | 'word-cloud' | 'mind-map';
    mode: 'vertical' | 'left' | 'diagonal';
  } | null>(null);

  const handleCopy = useCallback((id: string) => {
    if (id === 'insights') {
      const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
      navigator.clipboard.writeText(text);
      alert('Insights copied to clipboard!');
    } else if (id === 'knowledge-graph') {
      const text = graph.nodes.map((n) => `${n.label} (${n.entityType || 'concept'})`).join('\n');
      navigator.clipboard.writeText(text);
      alert('Knowledge Graph nodes list copied!');
    } else if (id === 'word-cloud') {
      const text = graph.nodes.map((n) => n.label).join(', ');
      navigator.clipboard.writeText(text);
      alert('Word Cloud text copied!');
    } else if (id === 'mind-map') {
      const text = graph.nodes.map((n) => `- ${n.label}`).join('\n');
      navigator.clipboard.writeText(text);
      alert('Mind Map nodes list copied!');
    }
  }, [graph, insights]);

  const handlePanelExport = useCallback((id: string) => {
    if (id === 'insights') {
      const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${nucleus.analysis?.title || 'analysis'}-insights.txt`;
      a.click();
    } else if (id === 'knowledge-graph') {
      const canvas = document.querySelector('.js-knowledge-graph-container canvas') as HTMLCanvasElement;
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${nucleus.analysis?.title || 'analysis'}-knowledge-graph.png`;
        a.click();
      } else {
        alert('Could not locate canvas element to export.');
      }
    } else if (id === 'word-cloud') {
      const canvas = document.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = url;
        a.download = `${nucleus.analysis?.title || 'analysis'}-word-cloud.png`;
        a.click();
      } else {
        alert('Could not locate canvas element to export.');
      }
    } else if (id === 'mind-map') {
      const svg = document.querySelector('.js-mind-map-container svg') as SVGElement;
      if (svg) {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${nucleus.analysis?.title || 'analysis'}-mind-map.svg`;
        a.click();
      } else {
        alert('Could not locate SVG element to export.');
      }
    }
  }, [nucleus.analysis?.title, graph, insights]);

  // Define Right Panel Accordion Items
  const rightPanelItems = useMemo(() => [
    {
      id: 'insights',
      title: 'Insights',
      defaultOpen: true,
      content: (
        <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} insights={insights} insightsLoading={insightsLoading} />
      ),
      onAction: (action: any) => {
        if (action === 'copy') handleCopy('insights');
        else if (action === 'export') handlePanelExport('insights');
        else setExpandedPanel(prev => prev?.id === 'insights' && prev?.mode === action ? null : { id: 'insights', mode: action });
      }
    },
    {
      id: 'knowledge-graph',
      title: 'Knowledge Graph',
      content: (
        <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onFocus={setSelectedNodeId} compact={true} />
      ),
      onAction: (action: any) => {
        if (action === 'copy') handleCopy('knowledge-graph');
        else if (action === 'export') handlePanelExport('knowledge-graph');
        else setExpandedPanel(prev => prev?.id === 'knowledge-graph' && prev?.mode === action ? null : { id: 'knowledge-graph', mode: action });
      }
    },
    {
      id: 'word-cloud',
      title: 'Word Cloud',
      content: (
        <WordCloud graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
      ),
      onAction: (action: any) => {
        if (action === 'copy') handleCopy('word-cloud');
        else if (action === 'export') handlePanelExport('word-cloud');
        else setExpandedPanel(prev => prev?.id === 'word-cloud' && prev?.mode === action ? null : { id: 'word-cloud', mode: action });
      }
    },
    {
      id: 'mind-map',
      title: 'Mind Map',
      content: (
        <MindMap graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
      ),
      onAction: (action: any) => {
        if (action === 'copy') handleCopy('mind-map');
        else if (action === 'export') handlePanelExport('mind-map');
        else setExpandedPanel(prev => prev?.id === 'mind-map' && prev?.mode === action ? null : { id: 'mind-map', mode: action });
      }
    }
  ], [graph, selectedNodeId, insights, insightsLoading, handleCopy, handlePanelExport]);



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
    { key: 'atlas', label: 'The Atlas', icon: 'solar:globus-linear' },
    { key: 'history', label: 'Analysis History', icon: 'solar:folder-with-files-linear', badge: historyBadge },
    { key: 'settings', label: 'Settings', icon: 'solar:settings-linear' },
  ], [historyBadge]);

  const dimensions: Dimension[] = useMemo(() => {
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

    // If projection isn't ready but we're analyzing, show all 11 as idle/streaming skeletons
    if (!nucleus.projection && (status === 'analyzing' || status === 'downloading')) {
      return Array.from({ length: 11 }, (_, i) => ({
        key: `dim-skeleton-${i + 1}`,
        label: DIMENSION_LABELS[i + 1] || `Dimension ${i + 1}`,
        icon: DIMENSION_ICONS[i + 1] || "solar:bolt-linear",
        status: i === 0 ? 'streaming' : 'idle', // Stream first one as a visual cue
        content: '',
        span: (DIMENSION_SPANS[i + 1] || 1) as 1 | 2 | 3,
      }));
    }

    if (!nucleus.projection) return [];

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
    <div className="relative w-full h-screen overflow-hidden">
      <DashboardLayout
        sidebar={
          <Sidebar
            items={sidebarItems}
            activeKey={activeNav}
            onNavigate={(key) => {
              if (key === 'atlas') {
                router.push('/atlas');
              } else {
                setActiveNav(key as 'console' | 'history' | 'settings');
              }
            }}
            footer={
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
                <div 
                  title={profile.email} 
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: 'var(--accent-strong)',
                    color: 'var(--void)',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 'bold',
                    fontSize: 12,
                    flexShrink: 0
                  }}
                >
                  {profile.initials}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {profile.email.split('@')[0]}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--ink-secondary)', textTransform: 'capitalize' }}>
                    {profile.tier} Tier
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleSignOut}
                  title="Sign Out"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink-muted)',
                    cursor: 'pointer',
                    padding: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 6,
                    transition: 'color var(--dur-fast), background var(--dur-fast)',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'transparent'; }}
                >
                  <Icon icon="solar:logout-3-linear" size={16} />
                </button>
              </div>
            }
          >
            {showLog && (
              <ProcessingLog status={status === 'analyzing' || status === 'downloading' || status === 'parsing' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'} />
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
        <div className="h-full overflow-y-auto">
          <RightPanelAccordion items={rightPanelItems} />
        </div>
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
            onCancel={stopAnalysis}
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
                    <div className="flex flex-col gap-8">
                      <DimensionAccordion
                        dimensions={dimensions}
                        selectedDimensionKey={selectedDimensionKey}
                        onSelectDimension={setSelectedDimensionKey}
                        progress={status === 'analyzing' ? 'Processing...' : status === 'complete' ? '100% complete' : undefined}
                      />

                    </div>
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

    {/* Dimension Drawer — outside DashboardLayout to avoid inert conflict */}
    <DimensionDrawer 
      dimension={selectedDimension ? {
        label: selectedDimension.label,
        content: selectedDimension.content,
        icon: selectedDimension.icon
      } : null}
      onClose={() => setSelectedDimensionKey(null)}
    />

    {expandedPanel && (() => {
      const activeItem = rightPanelItems.find(item => item.id === expandedPanel.id);
      if (!activeItem) return null;

      let positioningStyles: React.CSSProperties = {};
      if (expandedPanel.mode === 'vertical') {
        positioningStyles = {
          position: 'absolute',
          right: '8px',
          top: '8px',
          bottom: '8px',
          width: '390px',
          zIndex: 60,
        };
      } else if (expandedPanel.mode === 'left') {
        positioningStyles = {
          position: 'absolute',
          left: '280px',
          width: 'calc(100% - 280px - 414px)',
          top: '400px',
          bottom: '100px',
          zIndex: 60,
        };
      } else if (expandedPanel.mode === 'diagonal') {
        positioningStyles = {
          position: 'absolute',
          left: '280px',
          right: '20px',
          top: '400px',
          bottom: '100px',
          zIndex: 60,
        };
      }

      return (
        <div 
          style={positioningStyles}
          className="border border-[var(--line-strong)] bg-[rgba(15,20,30,0.95)] backdrop-blur-xl rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.8),0_0_1px_rgba(0,242,254,0.15)] flex flex-col min-h-0 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--line)] bg-[rgba(20,25,35,0.4)]">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
              <h3 className="font-mono text-[11px] uppercase tracking-wider font-bold text-[var(--ink)]">
                Expanded View: {activeItem.title}
              </h3>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleCopy(expandedPanel.id)}
                title="Copy"
                className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
              >
                <Icon icon="solar:copy-linear" size={14} />
              </button>
              
              <button
                type="button"
                onClick={() => handlePanelExport(expandedPanel.id)}
                title="Export"
                className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--accent)] cursor-pointer flex items-center justify-center transition-colors"
              >
                <Icon icon="solar:download-linear" size={14} />
              </button>

              <div className="w-[1px] h-3 bg-[var(--line)] mx-1" />

              <button
                type="button"
                onClick={() => setExpandedPanel({ id: expandedPanel.id, mode: 'vertical' })}
                title="Vertical Mode"
                className={`p-1 bg-transparent border-0 cursor-pointer flex items-center justify-center transition-colors ${
                  expandedPanel.mode === 'vertical' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                }`}
              >
                <Icon icon="solar:maximize-square-minimalistic-linear" size={14} />
              </button>
              <button
                type="button"
                onClick={() => setExpandedPanel({ id: expandedPanel.id, mode: 'left' })}
                title="Left Mode"
                className={`p-1 bg-transparent border-0 cursor-pointer flex items-center justify-center transition-colors ${
                  expandedPanel.mode === 'left' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                }`}
              >
                <Icon icon="solar:double-alt-arrow-left-linear" size={14} />
              </button>
              <button
                type="button"
                onClick={() => setExpandedPanel({ id: expandedPanel.id, mode: 'diagonal' })}
                title="Diagonal Mode"
                className={`p-1 bg-transparent border-0 cursor-pointer flex items-center justify-center transition-colors ${
                  expandedPanel.mode === 'diagonal' ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                }`}
              >
                <Icon icon="solar:scale-linear" size={14} />
              </button>

              <div className="w-[1px] h-3 bg-[var(--line)] mx-1" />

              <button
                type="button"
                onClick={() => setExpandedPanel(null)}
                title="Close overlay"
                className="p-1 bg-transparent border-0 text-[var(--ink-muted)] hover:text-[var(--err)] cursor-pointer flex items-center justify-center transition-colors"
              >
                <Icon icon="solar:close-circle-linear" size={16} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5 hx-custom-scrollbar">
            {expandedPanel.id === 'knowledge-graph' ? (
              <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onFocus={setSelectedNodeId} compact={false} />
            ) : (
              activeItem.content
            )}
          </div>
        </div>
      );
    })()}
    </div>
  );
}