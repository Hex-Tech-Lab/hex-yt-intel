'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { DashboardLayout } from '@/components/templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '@/components/templates/console/Sidebar';
import { TopBar } from '@/components/templates/console/TopBar';
import { AnalysisHero } from '@/components/templates/console/AnalysisHero';
import { BentoMetadata } from '@/components/templates/console/BentoMetadata';
import { StreamingGrid, Dimension } from '@/components/templates/console/StreamingGrid';
import { PersonaSelector } from '@/components/templates/console/PersonaSelector';
import { ProcessingLog, LogLine } from '@/components/templates/console/ProcessingLog';
import { AnalysisHistory } from '@/components/templates/console/AnalysisHistory';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import type { ConsoleProfile } from '@/lib/services/console-profile';

export interface DashboardContainerProps {
  /** Authenticated user + quota snapshot, resolved server-side at route entry. */
  profile: ConsoleProfile;
}

export function DashboardContainer({ profile }: DashboardContainerProps) {
  const { status, error, videoMetadata, analysisHistory } = useAnalysisStore();
  const { url, setUrl } = useInputStore();
  const { startAnalysis } = useSSEStream();
  const { projection } = useSynthesisNucleus();
  const [search, setSearch] = useState('');
  const [activeNav, setActiveNav] = useState<'console' | 'history' | 'settings'>('console');

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
        content: dim.content,
        span: (DIMENSION_SPANS[dim.number] || 1) as 1 | 2 | 3,
      };
    });
  }, [projection, status]);

  // Handle log lines from streaming status
  const [logLines, setLogLines] = useState<LogLine[]>([]);

  useEffect(() => {
    if (status === 'downloading') {
      setLogLines([{ timestamp: new Date().toLocaleTimeString(), type: 'info', message: 'Initializing ingestion engine...' }]);
    } else if (status === 'analyzing') {
      setLogLines(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), type: 'ok', message: 'Stream established. Parsing UCIS dimensions...' }]);
    } else if (status === 'complete') {
      setLogLines(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), type: 'ok', message: 'Synthesis complete. Knowledge graph updated.' }]);
    } else if (status === 'error') {
      setLogLines(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), type: 'error', message: error?.message || 'Synthesis aborted.' }]);
    } else if (status === 'idle') {
      setLogLines([]);
    }
  }, [status, error]);

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
    >
      {activeNav === 'console' ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 48, paddingBottom: 80 }}>
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

          {status === 'complete' && <PersonaSelector />}

          <StreamingGrid
            dimensions={dimensions}
            progress={status === 'analyzing' ? 'Processing...' : status === 'complete' ? '100% complete' : undefined}
            onOpenDimension={(key) => console.log('Open dimension', key)}
          />

          <ProcessingLog
            lines={logLines}
            status={status === 'analyzing' || status === 'downloading' ? 'streaming' : status === 'complete' ? 'done' : status === 'error' ? 'error' : 'idle'}
          />
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
