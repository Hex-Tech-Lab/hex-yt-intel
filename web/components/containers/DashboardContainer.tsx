'use client';

import { useMemo, useState, useCallback, useEffect, useRef, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import type { Dimension } from '@/components/templates/console/DimensionAccordion';
import { DimensionAccordion } from '@/components/dashboard/DimensionAccordion';
import { VisualizationPanel } from '@/components/dashboard/VisualizationPanel';
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
import { useChatStore } from '@/store/useChatStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useEagerVideoMetadata } from '@/hooks/useEagerVideoMetadata';
import { parseToUCISDimensions } from '@/lib/utils/ucis-parser';
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

import * as Sentry from '@sentry/nextjs';

// See /docs/ui/dashboard-container.md

function showToast(message: string, type: 'success' | 'error' = 'success') {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 18px;border-radius:10px;font:600 12px/1.4 var(--font-mono);pointer-events:none;opacity:0;transition:opacity .2s;color:var(--ink);background:${type === 'error' ? 'rgba(239,68,68,0.9)' : 'rgba(6,182,212,0.9)'};backdrop-filter:blur(8px);`;
  document.body.appendChild(el);
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2000);
}

function reportClipboardError(error: unknown, context: string) {
  const message = error instanceof Error ? error.message : String(error);
  Sentry.captureException(error, { contexts: { clipboard: { context } } });
  console.error('[DashboardContainer] Clipboard copy failed:', { message, context });
}

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

  const showLog = status !== 'idle' && terminalLines.length > 0;

  const { url, setUrl } = useInputStore();
  const [mounted, setMounted] = useState(false);
  const hasHadVideoRef = useRef(false);

  const { startAnalysis, stopAnalysis } = useSSEStream();
  useEagerVideoMetadata();
  const nucleus = useSynthesisNucleus();

  useEffect(() => {
    setUserRole(profile.role);
  }, [profile.role, setUserRole]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const initializeAnalysis = useAnalysisStore((s) => s.initializeAnalysis);
  const setVideoMetadata = useAnalysisStore((s) => s.setVideoMetadata);
  const setStatus = useAnalysisStore((s) => s.setStatus);
  const initSynthesis = useSynthesisNucleus((s) => s.initializeAnalysis);

  // Auto-restore already analyzed videos
  useEffect(() => {
    if (!url) return;

    // Extract video ID
    let videoId = 'unknown';
    try {
      const normalized = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
      const parsed = new URL(normalized);
      if (parsed.hostname?.includes('youtu.be')) {
        videoId = parsed.pathname.slice(1);
      } else if (parsed.pathname.includes('/shorts/')) {
        videoId = parsed.pathname.split('/')[2] || 'unknown';
      } else if (parsed.pathname.includes('/live/')) {
        videoId = parsed.pathname.split('/')[2] || 'unknown';
      } else if (parsed.pathname.includes('/embed/') || parsed.pathname.includes('/v/')) {
        videoId = parsed.pathname.split('/')[2] || 'unknown';
      } else {
        videoId = parsed.searchParams.get('v') || 'unknown';
      }
    } catch (e) {
      console.debug('[AutoRestore] URL parsing exception:', e);
      videoId = 'unknown';
    }

    if (videoId === 'unknown' || videoId.length < 5) return;

    let cancelled = false;

    // Check if there's already a completed analysis for this videoId
    void (async () => {
      try {
        let res;
        try {
          res = await fetch(`/api/analyses/check?videoId=${videoId}`);
        } finally {
          // resource cleanup
        }
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.exists && data.status === 'complete' && data.analysisId) {
          console.log('[AutoRestore] Completed analysis detected for video, fetching details:', data.analysisId);
          
          // Trigger the restoration flow just like history restoration
          let restoreRes;
          try {
            restoreRes = await fetch(`/api/analyses/${data.analysisId}`);
          } finally {
            // resource cleanup
          }
          if (!restoreRes.ok) return;
          const restoreData = await restoreRes.json();
          if (cancelled) return;

          const dimensions = parseToUCISDimensions(restoreData.analysis_markdown || '');
          
          startTransition(() => {
            initializeAnalysis(restoreData.id, restoreData.title, restoreData.analysis_markdown);
            setVideoMetadata({
              videoId: restoreData.videoId,
              title: restoreData.title,
              channelTitle: restoreData.channelTitle || 'Unknown',
              publishedAt: restoreData.analysisAt || restoreData.created_at || new Date().toISOString(),
              duration: restoreData.duration || 0,
              viewCount: restoreData.viewCount || 0,
              likeCount: restoreData.likeCount || 0,
            } as any);

            initSynthesis({
              id: restoreData.id,
              videoId: restoreData.videoId,
              title: restoreData.title,
              channelTitle: restoreData.channelTitle,
              model: restoreData.model,
              analysisAt: restoreData.analysisAt,
              detectedPersona: restoreData.detectedPersona,
              dimensions,
              validation: restoreData.validation_report,
              streaming: restoreData.streaming,
            });

            // Rehydrate the rich metadata stores (persona / knowledge graph /
            // classification / monetization) so restored graphs render real
            // content — matches the history-click restore path in AnalysisHistory.
            if (restoreData.analysis_payload) {
              const payload = restoreData.analysis_payload;
              const nucleus = useSynthesisNucleus.getState();
              if (payload.persona) nucleus.setPersonaConfig(payload.persona);
              if (payload.knowledgeGraph) nucleus.setKnowledgeGraph(payload.knowledgeGraph);
              if (payload.classification) nucleus.setClassification(payload.classification);
              if (payload.monetizationVerdict) nucleus.setMonetizationVerdict(payload.monetizationVerdict);
            }

            setStatus('complete');
          });

          // Ground/Select the chat session in the background
          void (async () => {
            try {
              const chatStore = useChatStore.getState();
              await chatStore.loadConversations();
              const existing = chatStore.conversations.find((c) => 
                c.analysisId === restoreData.id || c.videoId === restoreData.videoId
              );
              if (existing) {
                if (existing.analysisId !== restoreData.id) {
                  await chatStore.updateConversationAnalysisId(existing.id, restoreData.id);
                }
                await chatStore.selectConversation(existing.id);
              } else {
                useChatStore.setState({ activeId: null });
              }
            } catch (e) {
              console.debug('[AutoRestore] Background chat session restoration failed:', e);
            }
          })();
        }
      } catch (err) {
        console.debug('[AutoRestore] Pre-flight cache check failed:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, initializeAnalysis, initSynthesis, setStatus, setVideoMetadata]);

  const supabase = createClient();
  const router = useRouter();
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  // Track if we've ever had a video — prevents player from disappearing between analyses
  if (videoMetadata?.videoId || nucleus.analysis?.videoId) {
    hasHadVideoRef.current = true;
  }

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
    try {
      if (id === 'insights') {
        const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
        navigator.clipboard.writeText(text).then(() => showToast('Insights copied to clipboard!')).catch((err) => reportClipboardError(err, 'insights'));
      } else if (id === 'knowledge-graph') {
        const text = graph.nodes.map((n) => `${n.label} (${n.entityType || 'concept'})`).join('\n');
        navigator.clipboard.writeText(text).then(() => showToast('Knowledge Graph nodes list copied!')).catch((err) => reportClipboardError(err, 'knowledge-graph'));
      } else if (id === 'word-cloud') {
        const text = graph.nodes.map((n) => n.label).join(', ');
        navigator.clipboard.writeText(text).then(() => showToast('Word Cloud text copied!')).catch((err) => reportClipboardError(err, 'word-cloud'));
      } else if (id === 'mind-map') {
        const text = graph.nodes.map((n) => `- ${n.label}`).join('\n');
        navigator.clipboard.writeText(text).then(() => showToast('Mind Map nodes list copied!')).catch((err) => reportClipboardError(err, 'mind-map'));
      }
    } catch (err) {
      reportClipboardError(err, 'outer');
      showToast('Copy failed', 'error');
    }
  }, [graph, insights]);

  const handlePanelExport = useCallback((id: string) => {
    if (id === 'insights') {
      const text = insights.map((ins) => `${ins.sourceLabel} -[${ins.kind}]-> ${ins.targetLabel}: ${ins.rationale || ''}`).join('\n');
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${nucleus.analysis?.title || 'analysis'}-insights.txt`;
      anchor.click();
      URL.revokeObjectURL(url);
    } else if (id === 'knowledge-graph') {
      const canvas = document.querySelector('.js-knowledge-graph-container canvas') as HTMLCanvasElement;
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${nucleus.analysis?.title || 'analysis'}-knowledge-graph.png`;
        anchor.click();
      } else {
        showToast('Could not locate canvas element to export.', 'error');
      }
    } else if (id === 'word-cloud') {
      const canvas = document.querySelector('.js-word-cloud-canvas') as HTMLCanvasElement;
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${nucleus.analysis?.title || 'analysis'}-word-cloud.png`;
        anchor.click();
      } else {
        showToast('Could not locate canvas element to export.', 'error');
      }
    } else if (id === 'mind-map') {
      const svg = document.querySelector('.js-mind-map-container svg') as SVGElement;
      if (svg) {
        const serializer = new XMLSerializer();
        const svgString = serializer.serializeToString(svg);
        const blob = new Blob([svgString], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${nucleus.analysis?.title || 'analysis'}-mind-map.svg`;
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        showToast('Could not locate SVG element to export.', 'error');
      }
    }
  }, [nucleus.analysis?.title, insights]);

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
    if (!nucleus.analysis?.id) return;
    if (format === 'pdf') {
      window.open(`/api/analyses/${nucleus.analysis.id}/export?format=pdf&scope=full`, '_blank');
    } else {
      const content = analysis?.analysis_markdown || '';
      const blob = new Blob([content], { type: 'text/markdown' });
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = `${nucleus.analysis.title || 'synthesis'}.md`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
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
          onSearchChange={(v) => startTransition(() => setSearch(v))}
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
        <div className="flex flex-col gap-4 pb-4">
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

          {(hasHadVideoRef.current || videoMetadata || nucleus.analysis?.videoId) && (
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
            <div className="flex flex-col gap-4">
              <ConsoleTabSwitcher activeTab={consoleTab} hasGraph={graph.nodes.length > 0} onTabChange={setConsoleTab} />

              {consoleTab === 'synthesis' ? (
                <>
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