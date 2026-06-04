'use client';

import { useMemo, useState, useCallback } from 'react';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import { StreamingGrid, Dimension } from '@/components/templates/console/StreamingGrid';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { ProcessingLog } from '@/components/templates/console/ProcessingLog';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { KnowledgeGraphCanvas } from '@/components/templates/console/KnowledgeGraphCanvas';
import { IntelligencePanel } from '@/components/templates/console/IntelligencePanel';
import { ChatDock } from '@/components/templates/console/ChatDock';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { useKnowledgeGraph } from '@/hooks/useKnowledgeGraph';
import { Icon } from '@/components/templates/_shared/primitives';
import type { ConsoleProfile } from '@/lib/services/console-profile';

export interface DashboardContainerProps {
  /** Authenticated user + quota snapshot, resolved server-side at route entry. */
  profile: ConsoleProfile;
}

/**
 * Presentation transform for dimension cards: the full synthesis is stored verbatim,
 * but cards should lead with substance — strip leading markdown headers, "DIMENSION N"
 * lines and "8.1"-style section numbers so the content starts immediately.
 */
function cleanDimensionContent(raw: string): string {
  return (raw || '')
    .replace(/^\s*#{1,6}\s+.*$/gm, '')          // markdown headers
    .replace(/^\s*DIMENSION\s+\d+\b.*$/gim, '')  // "DIMENSION 8 – ..." lines
    .replace(/^\s*\d+(?:\.\d+)*[.)]?\s+(?=\S)/gm, '') // leading "8.1 " section numbers
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function DashboardContainer({ profile }: DashboardContainerProps) {
  const { status, error, videoMetadata, analysisHistory } = useAnalysisStore();
  const { url, setUrl } = useInputStore();
  const { startAnalysis } = useSSEStream();
  const { projection, analysis } = useSynthesisNucleus();
  const { graph } = useKnowledgeGraph();
  const [search, setSearch] = useState('');
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');
  const [consoleTab, setConsoleTab] = useState<'synthesis' | 'graph'>('synthesis');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  // Sidebar navigation items
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
          account={<div title={profile.email} style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--accent)', display: 'grid', placeItems: 'center', color: 'var(--void)', fontWeight: 'bold', fontSize: 12 }}>{profile.initials}</div>}
        />
      }
      dock={<ChatDock analysisId={analysis?.id ?? null} analysisTitle={videoMetadata?.title} />}
    >
      {activeNav === 'console' ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 32, paddingBottom: 16 }}>
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
              {/* Tab bar: Synthesis grid vs. Knowledge graph */}
              <div style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, border: '1px solid var(--line)', background: 'rgb(11 14 20 / 0.5)', alignSelf: 'flex-start' }}>
                {([
                  { key: 'synthesis', label: 'Synthesis', icon: 'solar:widget-5-linear' },
                  { key: 'graph', label: 'Knowledge Graph', icon: 'solar:share-circle-linear' },
                ] as const).map((t) => {
                  const active = consoleTab === t.key;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setConsoleTab(t.key as 'synthesis' | 'graph')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', borderRadius: 9,
                        border: 'none', cursor: 'pointer',
                        background: active ? 'var(--accent)' : 'transparent',
                        color: active ? 'var(--void)' : 'var(--ink-secondary)',
                        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
                        transition: 'background 0.15s, color 0.15s',
                      }}
                    >
                      <Icon icon={t.icon} size={15} />
                      {t.label}
                    </button>
                  );
                })}
              </div>

              {consoleTab === 'synthesis' ? (
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 32 }}>
                    {status === 'complete' && <PersonaSelector />}
                    <StreamingGrid
                      dimensions={dimensions}
                      progress={status === 'analyzing' ? 'Processing...' : status === 'complete' ? '100% complete' : undefined}
                      onOpenDimension={(key) => setSelectedNodeId(`dim-${key.replace('dim-', '')}`)}
                    />
                    <ProcessingLog
                      status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'}
                    />
                  </div>

                  {/* Persistent intelligence rail — present whenever an analysis is
                      active/done; populates live as dimensions arrive (no 2-dim gate). */}
                  <aside style={{ width: 340, flexShrink: 0, position: 'sticky', top: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--ink-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Intelligence</span>
                      {graph.nodes.length > 0 && (
                        <button
                          onClick={() => setConsoleTab('graph')}
                          title="Open full graph"
                          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'var(--accent-ink)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10.5 }}
                        >
                          <Icon icon="solar:maximize-square-linear" size={13} /> expand
                        </button>
                      )}
                    </div>
                    {graph.nodes.length > 0 ? (
                      <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} compact height={260} />
                    ) : (
                      <div style={{ height: 260, borderRadius: 14, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, padding: 16, lineHeight: 1.6 }}>
                        {status === 'complete' ? 'No relational structure for this analysis.' : 'Synthesizing… the graph populates as dimensions arrive.'}
                      </div>
                    )}
                    <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
                  </aside>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {graph.nodes.length > 0 ? (
                      <KnowledgeGraphCanvas graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} onFocus={setSelectedNodeId} height={580} />
                    ) : (
                      <div style={{ height: 580, borderRadius: 14, border: '1px dashed var(--line)', display: 'grid', placeItems: 'center', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 12.5, padding: 24, lineHeight: 1.6 }}>
                        {status === 'complete' ? 'No graph relations were synthesized for this analysis.' : 'The knowledge graph builds live as dimensions arrive…'}
                      </div>
                    )}
                    <p style={{ marginTop: 10, color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6 }}>
                      Left-click to inspect · right-click to pin &amp; focus · drag to reposition · scroll to zoom
                    </p>
                  </div>
                  <aside style={{ width: 360, flexShrink: 0, position: 'sticky', top: 16 }}>
                    <IntelligencePanel graph={graph} selectedId={selectedNodeId} onSelect={setSelectedNodeId} />
                  </aside>
                </div>
              )}
            </>
          )}
        </div>
      ) : activeNav === 'history' ? (
        <AnalysisHistory />
      ) : (
        <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
          Settings coming soon...
        </div>
      )}

    </DashboardLayout>
  );
}
