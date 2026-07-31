'use client';

import { useMemo, useState, useCallback, useEffect, useRef, startTransition, ViewTransition } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
import { useTotalDimensions, useSynthesisConfig } from '@/lib/config/synthesis-with-settings';
import { VisualizationPanel } from '@/components/dashboard/VisualizationPanel';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { IntelligencePanel } from '@/components/templates/console/IntelligencePanel';
import { ChatDock } from '@/components/templates/console/ChatDock';
import { RightPanelAccordion } from '@/components/dashboard/RightPanelAccordion';
import { ExecutiveSummary } from '@/components/organisms/ExecutiveSummary';
import { Icon, StatusBadge } from '@/components/templates/_shared/primitives';
import { useVideoStore } from '@/store/useVideoStore';
import { useStreamReattach } from '@/hooks/useStreamReattach';

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
import { useAuxElementStatus } from '@/hooks/useAuxElementStatus';
import { extractVideoId } from '@/lib/youtube';
import { useExistingAnalysisCheck } from '@/hooks/useExistingAnalysisCheck';
import { UsageTab } from '@/components/templates/console/UsageTab';
import { SettingsContentPane, SETTINGS_TREE, type SettingsSubmenuKey } from '@/components/containers/dashboard/SettingsPanel';
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
import { parseUcisDimensionNumbers } from '@/lib/utils/count-ucis-dimensions';
import { Avatar } from '@astryxdesign/core';

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
  const { pendingNav, clearPendingNav } = useVideoStore();

  useEffect(() => {
    if (pendingNav) {
      startTransition(() => {
        setActiveNav(pendingNav);
        clearPendingNav();
      });
    }
  }, [pendingNav, clearPendingNav]);
  const setUserRole = useAnalysisStore((s) => s.setUserRole);
  const status = useAnalysisStore((s) => s.status);
  const analysisHistory = useAnalysisStore((s) => s.analysisHistory);
  const analysis = useAnalysisStore((s) => s.analysis);
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const error = useAnalysisStore((s) => s.error);
  const terminalLines = useAnalysisStore((s) => s.terminalLines);
  const TOTAL_DIMENSIONS = useTotalDimensions();
  const { dimensionConfigs } = useSynthesisConfig();

  const showLog = status !== 'idle' && terminalLines.length > 0;

  const { url, setUrl } = useInputStore();
  const [mounted, setMounted] = useState(false);
  const hasHadVideoRef = useRef(false);
  const hasExistingAnalysis = useExistingAnalysisCheck(url);

  const { startAnalysis, stopAnalysis, isLiveStreaming } = useSSEStream();
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
  useStreamReattach(nucleusAnalysis?.id ?? analysis?.id ?? null, status, isLiveStreaming);

  // Memoized so the client instance (and therefore `handleSignOut`'s identity)
  // stays stable across renders — createClient() otherwise builds a new
  // client object every call, which would defeat useCallback below.
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/');
  }, [supabase, router]);

  // Track if we've ever had a video and sync input URL box
  useEffect(() => {
    const activeVideoId = videoMetadata?.videoId || nucleusAnalysis?.videoId;
    if (activeVideoId) {
      hasHadVideoRef.current = true;
      const currentInputId = extractVideoId(useInputStore.getState().url);
      if (!useInputStore.getState().url || currentInputId !== activeVideoId) {
        useInputStore.getState().setUrl(`https://www.youtube.com/watch?v=${activeVideoId}`);
      }
    }
  }, [videoMetadata?.videoId, nucleusAnalysis?.videoId]);

  const { graph } = useKnowledgeGraph(nucleusAnalysis?.id);
  const { insights, loading: insightsLoading } = useRelations(nucleusAnalysis?.id ?? null, status === 'complete');
  const [search, setSearch] = useState('');
  // Closes the mobile/tablet nav drawer. The console/history/settings views
  // switch via in-page `activeNav` state (not a route change), so the layout's
  // close-on-route-change effect never fires for them — we close it explicitly.
  const setMobileNav = useUIStore((s) => s.setMobileNav);
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  // Settings is a collapsible node WITHIN the left nav (not a separate
  // route/shell) -- collapsed by default, and its expand/collapse state is
  // independent of which submenu leaf is currently rendered in the central
  // panel (collapsing after selecting a leaf must not clear the content).
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [activeSettingsLeaf, setActiveSettingsLeaf] = useState<SettingsSubmenuKey>('overview');
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
  // Astryx <Avatar> derives initials from `name` by first-lettering each
  // whitespace-separated word; a raw email (no space) would collapse to a
  // single letter. Reconstruct a two-word string so it reproduces
  // profile.initials exactly instead of re-deriving (and mangling) it.
  const accountAvatarName = profile.initials.length >= 2
    ? `${profile.initials[0]} ${profile.initials.slice(1)}`
    : profile.initials;

  // Partial-analysis awareness: count dimensions that actually carry content and,
  // when a completed analysis is missing some of the 11, surface which ones so the
  // user can decide whether to re-analyze (a re-run bypasses the cache).
  //
  // Derived from `analysis.analysis_markdown` via `parseUcisDimensionNumbers` --
  // the SAME canonical, content-based presence check AnalysisHistory's WIP card
  // uses (`countUcisDimensions`) -- not a status flag and not a second,
  // independently-written parse. Both surfaces must agree on this count for the
  // same analysis (regression: AnalysisHistory previously hardcoded
  // TOTAL_DIMENSIONS whenever currentStatus === 'complete', which showed 11/11
  // for analyses with billing_status: 'failed').
  const partialInfo = useMemo(() => {
    if (status !== 'complete' || !analysis?.analysis_markdown) return null;
    const presentNumbers = parseUcisDimensionNumbers(analysis.analysis_markdown);
    const presentCount = presentNumbers.length;
    if (presentCount === 0 || presentCount >= TOTAL_DIMENSIONS) return null;
    const present = new Set(presentNumbers);
    const missing: number[] = [];
    for (let i = 1; i <= TOTAL_DIMENSIONS; i++) {
      if (!present.has(i)) missing.push(i);
    }
    return { presentCount, missing };
  }, [analysis?.analysis_markdown, status, TOTAL_DIMENSIONS]);

  // Dimension 0 — executive digest. Generated once (the cheap "#12 call") the
  // first time a completed, full analysis is viewed, then cached server-side, so
  // re-opening it returns the stored digest without re-spending. Also generated for
  // partial analyses so Synthesis Console is accessible for re-analysis.
  const analysisId = nucleusAnalysis?.id ?? null;
  const { digest, digestLoading, mappedDigestData } = useExecutiveDigest(analysisId, status);
  const auxStatus = useAuxElementStatus(analysisId, status);

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
      // Fire-and-forget: the Blob download above has no server round-trip,
      // so without this the admin User Activity dashboard can never see a
      // markdown download (only PDF export logs server-side directly).
      fetch(`/api/analyses/${nucleusAnalysis.id}/download-event`, { method: 'POST' }).catch(() => {});
    }
  }, [nucleusAnalysis?.id, nucleusAnalysis?.title, analysis?.analysis_markdown]);

  const sidebarItems: SidebarItem[] = useMemo(() => [
    { key: 'console', label: 'Synthesis Console', icon: 'solar:graph-up-linear' },
    { key: 'atlas', label: 'The Atlas', icon: 'solar:globus-linear' },
    { key: 'history', label: 'Analysis History', icon: 'solar:folder-with-files-linear', badge: historyBadge },
    {
      key: 'settings',
      label: 'Settings',
      icon: 'solar:settings-linear',
      submenu: [
        { key: 'overview', label: 'Overview', icon: 'solar:home-2-linear' },
        ...SETTINGS_TREE.map((item) => ({
          key: item.key,
          label: item.label,
          icon: item.icon,
          category: item.category,
        })),
      ],
    },
  ], [historyBadge]);

  const dimensions: Dimension[] = useMemo(() => {
    // If projection isn't ready but we're analyzing, show all dimensions as idle/streaming skeletons
    if (!nucleusProjection && (status === 'analyzing' || status === 'downloading')) {
      return Array.from({ length: TOTAL_DIMENSIONS }, (_, i) => {
        const num = i + 1;
        const cfg = dimensionConfigs[num];
        return {
          key: `dim-skeleton-${num}`,
          label: cfg?.label || `Dimension ${num}`,
          icon: cfg?.icon || "solar:bolt-linear",
          status: i === 0 ? 'streaming' : 'idle',
          content: '',
          span: (cfg?.span || 1) as 1 | 2 | 3,
        };
      });
    }

    if (!nucleusProjection) return [];

    const rawReceived = nucleusAnalysis?.streaming.dimensionsReceived;
    const receivedList: number[] = [];
    if (Array.isArray(rawReceived)) {
      for (const valItem of rawReceived) {
        if (typeof valItem === 'number') receivedList.push(valItem);
      }
    }

    const visibleDimensionNumbers = nucleusProjection.visibleDimensions.map(d => d.number);
    const visibleReceivedList: number[] = [];
    for (const numItem of receivedList) {
      if (visibleDimensionNumbers.includes(numItem)) visibleReceivedList.push(numItem);
    }
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

      const cfg = dimensionConfigs[dim.number] || (dimensionConfigs as any)[String(dim.number)];

      return {
        key: `dim-${dim.number}`,
        label: cfg?.label || cfg?.name || dim.name || `Dimension ${dim.number}`,
        icon: cfg?.icon || "solar:bolt-linear",
        status: dimStatus,
        content: cleanDimensionContent(dim.content),
        span: (cfg?.span || 1) as 1 | 2 | 3,
      };
    });
  }, [nucleusProjection, status, nucleusAnalysis?.streaming.dimensionsReceived, TOTAL_DIMENSIONS, dimensionConfigs]);

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
      startTransition(() => {
        setActiveNav(key as 'console' | 'history' | 'settings');
      });
    }
  }, [setMobileNav, router]);

  // Settings header click: toggle the inline disclosure only. This does NOT
  // navigate -- expanding/collapsing the submenu list must not change
  // whatever is currently showing in the central panel.
  const handleToggleSettingsSubmenu = useCallback(() => {
    startTransition(() => setSettingsExpanded((prev) => !prev));
  }, []);

  // Clicking a Settings submenu leaf is the only thing that actually swaps
  // the central panel into the Settings content for that leaf.
  const handleNavigateSettingsLeaf = useCallback((_parentKey: string, leafKey: string) => {
    setMobileNav(false);
    startTransition(() => {
      setActiveNav('settings');
      setActiveSettingsLeaf(leafKey as SettingsSubmenuKey);
    });
  }, [setMobileNav]);

  const handleCloseDimensionDrawer = useCallback(() => {
    startTransition(() => setSelectedDimensionKey(null));
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
            expandedKeys={{ settings: settingsExpanded }}
            onToggleSubmenu={handleToggleSettingsSubmenu}
            activeSubKey={activeNav === 'settings' ? activeSettingsLeaf : null}
            onNavigateSub={handleNavigateSettingsLeaf}
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
          account={<Avatar name={accountAvatarName} alt={profile.email} size={32} />}
        />
      }
      rightPanel={
        <AnimatePresence mode="wait">
          {rightPanelItems.length > 0 && (
            <motion.div
              key="right-panel"
              initial={{ x: 20, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 20, opacity: 0 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="h-full overflow-y-auto"
            >
              <RightPanelAccordion items={rightPanelItems} />
            </motion.div>
          )}
        </AnimatePresence>
      }
      dock={<ChatDock analysisId={nucleusAnalysis?.id ?? null} analysisTitle={videoMetadata?.title} />}
    >
      <ViewTransition enter="slide-in-up" exit="fade-out" default="none">
        <div key={activeNav}>
          {activeNav === 'console' ? (
            <div className="flex flex-col gap-1.5 pb-2">
              <AnalysisHero
                url={mounted ? url : ''}
                status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'}
                onUrlChange={setUrl}
                onAnalyze={handleAnalyze}
                onReanalyze={handleReanalyze}
                onCancel={stopAnalysis}
                error={error?.message}
                quota={quotaLabel}
                isRepeat={status === 'complete' || hasExistingAnalysis}
              />

              {(hasHadVideoRef.current || videoMetadata || nucleusAnalysis?.videoId) && (
                <div className="flex flex-col gap-1">
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
                <div className="flex flex-col gap-1">
                  <ConsoleTabSwitcher activeTab={consoleTab} hasGraph={graph.nodes.length > 0} onTabChange={(t) => startTransition(() => setConsoleTab(t))} />

                  {consoleTab === 'synthesis' ? (
                    <>
                      {status === 'complete' && (digest || digestLoading) && (
                        <ExecutiveSummary data={mappedDigestData} loading={digestLoading} />
                      )}
                      {partialInfo && (
                        <div
                          role="status"
                          className="rounded-lg border border-[var(--warn)]/60 bg-[var(--warn)]/10 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--ink-main)] shadow-[0_0_14px_rgba(245,158,11,0.25)] flex items-center gap-2.5"
                        >
                          <Icon icon="solar:danger-triangle-linear" size={16} className="text-[var(--warn)] flex-shrink-0" />
                          <div>
                            <span className="font-mono font-bold text-[var(--warn)]">Partial analysis warning</span>
                            {` — ${partialInfo.presentCount} of ${TOTAL_DIMENSIONS} dimensions generated. `}
                            <span className="text-[var(--ink-muted)]">Missing: {partialInfo.missing.join(', ')}.</span>
                            {' Use Re-analyze to attempt the rest.'}
                          </div>
                        </div>
                      )}
                      {status === 'complete' && auxStatus && (
                        <div className="flex flex-wrap gap-2" role="status" aria-label="Auxiliary data status">
                          <StatusBadge status={digest ? 'done' : 'idle'} label="Digest" tooltip="Executive summary digest generated from analysis" />
                          <StatusBadge status={auxStatus.description ? 'done' : 'idle'} label="Description" tooltip="YouTube video description ingested" />
                          <StatusBadge status={auxStatus.channelMeta ? 'done' : 'idle'} label="Channel Meta" tooltip="Channel metadata and statistics enriched" />
                          <StatusBadge status={auxStatus.comments ? 'done' : 'idle'} label="Comments" tooltip="Top audience comments sampled and analyzed" />
                        </div>
                      )}
                      {status === 'complete' && dimensions.length > 0 && <PersonaSelector />}
                      <DimensionAccordion
                        dimensions={dimensions}
                        selectedDimensionKey={selectedDimensionKey}
                        onSelectDimension={(k) => startTransition(() => setSelectedDimensionKey(k))}
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
            <AnalysisHistory onSelectAnalysis={() => startTransition(() => setActiveNav('console'))} />
          ) : (activeNav as string) === 'settings' ? (
            <SettingsContentPane
              activeKey={activeSettingsLeaf}
              onNavigate={setActiveSettingsLeaf}
            />
          ) : (
            <UsageTab />
          )}
        </div>
      </ViewTransition>
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
