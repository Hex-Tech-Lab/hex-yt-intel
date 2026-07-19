'use client';

import { useMemo, useState, useCallback, useEffect, useRef, startTransition } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import type { Dimension } from '@/components/templates/console/DimensionAccordion';
import { DimensionAccordion } from '@/components/dashboard/DimensionAccordion';
import { useTotalDimensions } from '@/lib/config/synthesis-with-settings';
import { VisualizationPanel } from '@/components/dashboard/VisualizationPanel';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { IntelligencePanel } from '@/components/templates/console/IntelligencePanel';
import { ChatDock } from '@/components/templates/console/ChatDock';
import { RightPanelAccordion } from '@/components/dashboard/RightPanelAccordion';
import { ExecutiveSummary } from '@/components/organisms/ExecutiveSummary';

// Lazy load visualization components to reduce initial bundle size
const KnowledgeGraphCanvas = dynamic(() => import('@/components/templates/console/KnowledgeGraphCanvas').then(mod => ({ default: mod.KnowledgeGraphCanvas })), { ssr: false, loading: () => <div className="w-full h-full bg-slate-900 animate-pulse" /> });
const WordCloud = dynamic(() => import('@/components/templates/console/WordCloud').then(mod => ({ default: mod.WordCloud })), { ssr: false, loading: () => <div className="w-full h-full bg-slate-900 animate-pulse" /> });
const MindMap = dynamic(() => import('@/components/templates/console/MindMap').then(mod => ({ default: mod.MindMap })), { ssr: false, loading: () => <div className="w-full h-full bg-slate-900 animate-pulse" /> });
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useUIStore } from '@/store/useUIStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useEagerVideoMetadata } from '@/hooks/useEagerVideoMetadata';
import { useAutoRestoreAnalysis } from '@/hooks/useAutoRestoreAnalysis';
import { useExecutiveDigest } from '@/hooks/useExecutiveDigest';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { useRelations } from '@/hooks/useRelations';
import type { ConsoleProfile } from '@/lib/services/console-profile';
import { VideoPlayerCard } from '@/components/templates/console/VideoPlayerCard';
import { ProcessingLog } from '@/components/templates/console/ProcessingLog';
import { DimensionDrawer } from '@/components/templates/console/DimensionDrawer';
import { ConsoleTabSwitcher } from './dashboard/ConsoleTabSwitcher';
import { SidebarFooter } from './dashboard/SidebarFooter';
import { ExpandedPanelOverlay } from './dashboard/ExpandedPanelOverlay';
import { copyPanelContent, exportPanelContent, type PanelId } from '@/lib/dashboard/export';

// See /docs/ui/dashboard-container.md

export interface DashboardContainerProps {
  profile: ConsoleProfile;
}

function cleanDimensionContent(raw: string): string {
  if (!raw) return '';
  let content = raw.trim();

  // Strip markdown code fences without regex
  if (content.startsWith('```')) {
    const lines = content.split(/\r?\n/);
    lines.shift();
    if (lines.length > 0 && lines[lines.length - 1]?.trim() === '```') {
      lines.pop();
    }
    content = lines.join('\n').trim();
  }

  // Strip leading dimension headers (e.g., "### DIMENSION 1") with explicit pattern
  const lines = content.split(/\r?\n/);
  if (lines[0]) {
    const firstLine = lines[0].trim().toUpperCase();
    if (firstLine.startsWith('#') && /\bDIMENSION\s+\d+/.test(firstLine)) {
      lines.shift();
      content = lines.join('\n');
    }
  }

  return content.trim();
}

export function DashboardContainer({ profile }: DashboardContainerProps) {
  const setUserRole = useAnalysisStore((s) => s.setUserRole);
  const status = useAnalysisStore((s) => s.status);
  const analysisHistory = useAnalysisStore((s) => s.analysisHistory);
  const analysis = useAnalysisStore((s) => s.analysis);
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const error = useAnalysisStore((s) => s.error);
  const terminalLines = useAnalysisStore((s) => s.terminalLines);
  const TOTAL_DIMENSIONS = useTotalDimensions();

  const showLog = status !== 'idle' && terminalLines.length > 0;

  const { url, setUrl } = useInputStore();
  const [mounted, setMounted] = useState(false);
  const hasHadVideoRef = useRef(false);

  const { startAnalysis, stopAnalysis } = useSSEStream();
  useEagerVideoMetadata();
  const nucleusAnalysis = useSynthesisNucleus((s) => s.analysis);
  const nucleusProjection = useSynthesisNucleus((s) => s.projection);

  useEffect(() => {
    setUserRole(profile.role);
  }, [profile.role, setUserRole]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useAutoRestoreAnalysis(url);

  // Memoized so the client instance (and therefore `handleSignOut`'s identity)
  // stays stable across renders — createClient() otherwise builds a new
  // client object every call, which would defeat useCallback below.
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/');
  }, [supabase, router]);

  // Track if we've ever had a video — prevents player from disappearing between analyses
  if (videoMetadata?.videoId || nucleusAnalysis?.videoId) {
    hasHadVideoRef.current = true;
  }

  const { graph } = useKnowledgeGraph(nucleusAnalysis?.id);
  const { insights, loading: insightsLoading } = useRelations(nucleusAnalysis?.id ?? null, status === 'complete');
  const [search, setSearch] = useState('');
  // Closes the mobile/tablet nav drawer. The console/history/settings views
  // switch via in-page `activeNav` state (not a route change), so the layout's
  // close-on-route-change effect never fires for them — we close it explicitly.
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedDimensionKey, setSelectedDimensionKey] = useState<string | null>(null);
  const [consoleTab, setConsoleTab] = useState<'synthesis' | 'graph'>('synthesis');

  const [expandedPanel, setExpandedPanel] = useState<{
    id: 'insights' | 'knowledge-graph' | 'word-cloud' | 'mind-map';
    mode: 'vertical' | 'left' | 'diagonal';
  } | null>(null);

  const handleCopy = useCallback((id: string) => {
    copyPanelContent(id as PanelId, { graph, insights });
  }, [graph, insights]);

  const handlePanelExport = useCallback((id: string) => {
    exportPanelContent(id as PanelId, { insights, title: nucleusAnalysis?.title });
  }, [nucleusAnalysis?.title, insights]);

  const handleSelectNode = useCallback((id: string | null) => {
    startTransition(() => setSelectedNodeId(id));
  }, []);

  // Define Right Panel Accordion Items
  const handleExpandPanel = useCallback((id: string, mode: string) => {
    startTransition(() => {
      setExpandedPanel(prev => prev?.id === id && prev?.mode === mode ? null : { id: id as 'insights' | 'knowledge-graph' | 'word-cloud' | 'mind-map', mode: mode as 'vertical' | 'left' | 'diagonal' });
    });
  }, []);

  const rightPanelItems = useMemo(() => [
    {
      id: 'insights',
      title: 'Insights',
      defaultOpen: true,
      content: () => (
        <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={handleSelectNode} insights={insights} insightsLoading={insightsLoading} />
      ),
      onAction: (action: 'vertical' | 'left' | 'diagonal' | 'copy' | 'export') => {
        if (action === 'copy') handleCopy('insights');
        else if (action === 'export') handlePanelExport('insights');
        else handleExpandPanel('insights', action);
      }
    },
    {
      id: 'knowledge-graph',
      title: 'Knowledge Graph',
      content: () => (
        <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={handleSelectNode} onFocus={(id) => startTransition(() => setSelectedNodeId(id))} compact />
      ),
      onAction: (action: 'vertical' | 'left' | 'diagonal' | 'copy' | 'export') => {
        if (action === 'copy') handleCopy('knowledge-graph');
        else if (action === 'export') handlePanelExport('knowledge-graph');
        else handleExpandPanel('knowledge-graph', action);
      }
    },
    {
      id: 'word-cloud',
      title: 'Word Cloud',
      content: () => (
        <WordCloud graph={graph} selectedId={selectedNodeId} onSelect={handleSelectNode} />
      ),
      onAction: (action: 'vertical' | 'left' | 'diagonal' | 'copy' | 'export') => {
        if (action === 'copy') handleCopy('word-cloud');
        else if (action === 'export') handlePanelExport('word-cloud');
        else handleExpandPanel('word-cloud', action);
      }
    },
    {
      id: 'mind-map',
      title: 'Mind Map',
      content: () => (
        <MindMap graph={graph} selectedId={selectedNodeId} onSelect={handleSelectNode} />
      ),
      onAction: (action: 'vertical' | 'left' | 'diagonal' | 'copy' | 'export') => {
        if (action === 'copy') handleCopy('mind-map');
        else if (action === 'export') handlePanelExport('mind-map');
        else handleExpandPanel('mind-map', action);
      }
    }
  ], [graph, selectedNodeId, insights, insightsLoading, handleCopy, handlePanelExport, handleExpandPanel, handleSelectNode]);



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

  // Partial-analysis awareness: count dimensions that actually carry content and,
  // when a completed analysis is missing some of the 11, surface which ones so the
  // user can decide whether to re-analyze (a re-run bypasses the cache).
  const partialInfo = useMemo(() => {
    const dims = nucleusAnalysis?.dimensions;
    if (status !== 'complete' || !dims) return null;
    const present = Object.entries(dims)
      .filter(([, d]) => d && typeof (d as { content?: unknown }).content === 'string' && ((d as { content: string }).content).trim().length > 0)
      .map(([k]) => Number(k))
      .filter((n) => Number.isFinite(n));
    const presentCount = new Set(present).size;
    if (presentCount === 0 || presentCount >= TOTAL_DIMENSIONS) return null;
    const missing = Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => i + 1).filter((n) => !present.includes(n));
    return { presentCount, missing };
  }, [nucleusAnalysis?.dimensions, status, TOTAL_DIMENSIONS]);

  // Dimension 0 — executive digest. Generated once (the cheap "#12 call") the
  // first time a completed, full analysis is viewed, then cached server-side, so
  // re-opening it returns the stored digest without re-spending. Also generated for
  // partial analyses so Synthesis Console is accessible for re-analysis.
  const analysisId = nucleusAnalysis?.id ?? null;
  const { digest, digestLoading, mappedDigestData } = useExecutiveDigest(analysisId, status);

  const getUserTimezone = (): string => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  };

  const handleAnalyze = useCallback(() => {
    if (!url) return;
    startTransition(() => {
      startAnalysis(url, getUserTimezone());
    });
  }, [url, startAnalysis]);

  const handleReanalyze = useCallback(() => {
    if (!url) return;
    startTransition(() => {
      startAnalysis(url, getUserTimezone(), true);
    });
  }, [url, startAnalysis]);

  const handleExport = useCallback((format: 'pdf' | 'markdown') => {
    if (!nucleusAnalysis?.id) return;
    if (format === 'pdf') {
      window.open(`/api/analyses/${nucleusAnalysis.id}/export?format=pdf&scope=full`, '_blank');
    } else {
      const content = analysis?.analysis_markdown || '';
      const blob = new Blob([content], { type: 'text/markdown' });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${nucleusAnalysis.title || 'synthesis'}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(downloadUrl);
    }
  }, [nucleusAnalysis?.id, nucleusAnalysis?.title, analysis?.analysis_markdown]);

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

    // If projection isn't ready but we're analyzing, show all dimensions as idle/streaming skeletons
    if (!nucleusProjection && (status === 'analyzing' || status === 'downloading')) {
      return Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => ({
        key: `dim-skeleton-${i + 1}`,
        label: DIMENSION_LABELS[i + 1] || `Dimension ${i + 1}`,
        icon: DIMENSION_ICONS[i + 1] || "solar:bolt-linear",
        status: i === 0 ? 'streaming' : 'idle', // Stream first one as a visual cue
        content: '',
        span: (DIMENSION_SPANS[i + 1] || 1) as 1 | 2 | 3,
      }));
    }

    if (!nucleusProjection) return [];

    const rawReceived = nucleusAnalysis?.streaming.dimensionsReceived;
    const receivedList = Array.isArray(rawReceived)
      ? rawReceived.filter((v): v is number => typeof v === 'number')
      : [];

    const visibleDimensionNumbers = nucleusProjection.visibleDimensions.map(d => d.number);
    const visibleReceivedList = receivedList.filter(num => visibleDimensionNumbers.includes(num));
    const lastVisibleReceived = visibleReceivedList.length > 0 ? visibleReceivedList[visibleReceivedList.length - 1] : null;

    return nucleusProjection.visibleDimensions.map((dim) => {
      let dimStatus: 'idle' | 'streaming' | 'done' | 'error' = 'idle';

      const isReceived = receivedList.includes(dim.number);
      // A restored analysis is 'complete' but its streaming.dimensionsReceived is
      // empty (nothing streamed this session), so keying 'done' purely on
      // isReceived greyed out every restored dimension — including the ones that
      // actually have content. Treat a dimension with real content as done so
      // partial restores show their created dimensions as expandable.
      const hasContent = typeof dim.content === 'string' && dim.content.trim().length > 0;

      if (status === 'complete') {
        dimStatus = (isReceived || hasContent) ? 'done' : 'idle';
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
  }, [nucleusProjection, status, nucleusAnalysis?.streaming.dimensionsReceived, TOTAL_DIMENSIONS]);

  const selectedDimension = useMemo(() => {
    if (!selectedDimensionKey) return null;
    return dimensions.find(d => d.key === selectedDimensionKey) || null;
  }, [selectedDimensionKey, dimensions]);

  const drawerDimensionData = useMemo(() => {
    if (!selectedDimension) return null;
    return {
      label: selectedDimension.label,
      content: selectedDimension.content,
      icon: selectedDimension.icon
    };
  }, [selectedDimension]);

  const handleSidebarNavigate = useCallback((key: string) => {
    // Dismiss the mobile/tablet drawer on any selection (iPad: the
    // in-page view switch below is not a route change, so the layout
    // won't auto-close it).
    setMobileNav(false);
    if (key === 'atlas') {
      router.push('/atlas');
    } else {
      setActiveNav(key as 'console' | 'history' | 'settings');
    }
  }, [setMobileNav, router]);

  const handleCloseDimensionDrawer = useCallback(() => {
    setSelectedDimensionKey(null);
  }, []);

  const handleSearchChange = useCallback((v: string) => {
    startTransition(() => setSearch(v));
  }, []);

  const handleSearchSubmit = useCallback(() => {
    const q = search.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  }, [search, router]);

  return (
    <div className="relative w-full min-h-[100dvh] xl:h-screen overflow-x-hidden xl:overflow-hidden">
      <DashboardLayout
        sidebar={
          <Sidebar
            items={sidebarItems}
            activeKey={activeNav}
            onNavigate={handleSidebarNavigate}
            footer={<SidebarFooter profile={profile} onSignOut={handleSignOut} />}
          >
            {showLog && (
              <ProcessingLog status={status === 'analyzing' || status === 'downloading' || status === 'parsing' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'} />
            )}
          </Sidebar>
        }
      topbar={
        <TopBar
          search={search}
          onSearchChange={handleSearchChange}
          onSearchSubmit={handleSearchSubmit}
          onExport={handleExport}
          tier={tierLabel}
          hasRightPanel={rightPanelItems.length > 0}
          account={<div title={profile.email} className="w-8 h-8 rounded-lg bg-[var(--accent)] grid place-items-center text-[var(--void)] font-bold text-xs">{profile.initials}</div>}
        />
      }
      rightPanel={
        <div className="h-full overflow-y-auto">
          <RightPanelAccordion items={rightPanelItems} />
        </div>
      }
      dock={<ChatDock analysisId={nucleusAnalysis?.id ?? null} analysisTitle={videoMetadata?.title} />}
    >
      {activeNav === 'console' ? (
        <div className="flex flex-col gap-3 pb-3">
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

          {(hasHadVideoRef.current || videoMetadata || nucleusAnalysis?.videoId) && (
            <div className="flex flex-col gap-3">
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
            <div className="flex flex-col gap-3">
              <ConsoleTabSwitcher activeTab={consoleTab} hasGraph={graph.nodes.length > 0} onTabChange={setConsoleTab} />

              {consoleTab === 'synthesis' ? (
                <>
                  {status === 'complete' && (digest || digestLoading) && (
                    <ExecutiveSummary data={mappedDigestData} loading={digestLoading} />
                  )}
                  {partialInfo && (
                    <div
                      role="status"
                      className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--ink-secondary)]"
                    >
                      <span className="font-mono font-semibold text-[var(--accent-ink)]">Partial analysis</span>
                      {` — ${partialInfo.presentCount} of ${TOTAL_DIMENSIONS} dimensions generated. `}
                      <span className="text-[var(--ink-muted)]">Missing: {partialInfo.missing.join(', ')}.</span>
                      {' Use Re-analyze to attempt the rest.'}
                    </div>
                  )}
                  {status === 'complete' && dimensions.length > 0 && <PersonaSelector />}
                  <DimensionAccordion
                    dimensions={dimensions}
                    selectedDimensionKey={selectedDimensionKey}
                    onSelectDimension={setSelectedDimensionKey}
                    status={status}
                  />
                </>
              ) : (
                <VisualizationPanel
                  graph={graph}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={handleSelectNode}
                  onFocusNode={(id) => startTransition(() => setSelectedNodeId(id))}
                />
              )}

            </div>
          )}
        </div>
      ) : (activeNav as string) === 'history' ? (
        <AnalysisHistory onSelectAnalysis={() => setActiveNav('console')} />
      ) : (
        <div className="p-6 text-center text-[var(--ink-secondary)]">
          Settings coming soon...
        </div>
      )}

    </DashboardLayout>

    {/* Dimension Drawer — outside DashboardLayout to avoid inert conflict */}
    <DimensionDrawer
      dimension={drawerDimensionData}
      onClose={handleCloseDimensionDrawer}
    />

    {expandedPanel && (() => {
      const activeItem = rightPanelItems.find(item => item.id === expandedPanel.id);
      if (!activeItem) return null;

      return (
        <ExpandedPanelOverlay
          panelId={expandedPanel.id}
          mode={expandedPanel.mode}
          title={activeItem.title}
          graph={graph}
          selectedNodeId={selectedNodeId}
          onSelectNode={handleSelectNode}
          onFocusNode={(id) => startTransition(() => setSelectedNodeId(id))}
          onCopy={handleCopy}
          onExport={handlePanelExport}
          onModeChange={(id, mode) => startTransition(() => setExpandedPanel({ id: id as 'insights' | 'knowledge-graph' | 'word-cloud' | 'mind-map', mode }))}
          onClose={() => setExpandedPanel(null)}
          content={activeItem.content}
        />
      );
    })()}
    </div>
  );
}
