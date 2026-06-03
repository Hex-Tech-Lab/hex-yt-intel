'use client';

import { useMemo, useState, useCallback, useEffect } from 'react';
import { DashboardLayout } from '../templates/console/DashboardLayout';
import { Sidebar, SidebarItem } from '../templates/console/Sidebar';
import { TopBar } from '../templates/console/TopBar';
import { AnalysisHero } from '../templates/console/AnalysisHero';
import { BentoMetadata } from '../templates/console/BentoMetadata';
import { StreamingGrid, Dimension } from '../templates/console/StreamingGrid';
import { ProcessingLog, LogLine } from '../templates/console/ProcessingLog';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useInputStore } from '@/store/useInputStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { parseUCISSections } from '@/lib/utils/ucis-parser';
import type { ConsoleProfile } from '@/lib/services/console-profile';

export interface DashboardContainerProps {
  /** Authenticated user + quota snapshot, resolved server-side at route entry. */
  profile: ConsoleProfile;
}

export function DashboardContainer({ profile }: DashboardContainerProps) {
  const { analysis, status, error, videoMetadata, analysisHistory } = useAnalysisStore();
  const { url, setUrl } = useInputStore();
  const { startAnalysis } = useSSEStream();
  const [search, setSearch] = useState('');

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

  const sections = useMemo(() => parseUCISSections(analysis?.analysis_markdown || ''), [analysis]);

  const dimensions: Dimension[] = useMemo(() => {
    // Explicit order mapping for UCIS v5.1 dimensions
    const order: (keyof typeof sections)[] = [
      'apex', 'provenance', 'architecture', 'psychological', 'coreIntelligence',
      'comparative', 'implementation', 'semantic', 'forward', 'credibility', 'monetization'
    ];

    const labels: Record<string, string> = {
      apex: "Apex Intelligence",
      provenance: "Provenance & Metadata",
      architecture: "Content Architecture",
      psychological: "Psychological Layer",
      coreIntelligence: "Core Intelligence",
      comparative: "Quantitative Analysis",
      implementation: "Implementation Systems",
      semantic: "Semantic Foundation",
      forward: "Forward Foresight",
      credibility: "Credibility & Risk",
      monetization: "Commercial Yield",
    };

    const icons: Record<string, string> = {
      apex: "solar:graph-up-linear",
      provenance: "solar:link-round-angle-linear",
      architecture: "solar:folder-with-files-linear",
      psychological: "solar:user-linear",
      coreIntelligence: "solar:bolt-linear",
      comparative: "solar:magnifer-linear",
      implementation: "solar:refresh-linear",
      semantic: "solar:crown-minimalistic-linear",
      forward: "solar:graph-up-linear",
      credibility: "solar:shield-check-linear",
      monetization: "solar:wad-of-money-linear",
    };

    const spans: Record<string, 1 | 2 | 3> = {
      apex: 3,             // Takes 4 columns (out of 6)
      coreIntelligence: 2, // Takes 3 columns
      monetization: 2,     // Takes 3 columns
    };

    return order.map((key) => {
      const content = sections[key];
      const isParsing = content === 'Parsing...';
      
      let dimStatus: 'idle' | 'streaming' | 'done' | 'error' = 'idle';
      if (status === 'complete') {
        dimStatus = isParsing ? 'idle' : 'done';
      } else if (status === 'analyzing' || status === 'downloading') {
        dimStatus = isParsing ? 'idle' : 'streaming';
      } else if (status === 'error') {
        dimStatus = 'error';
      }

      return {
        key,
        label: labels[key] || String(key),
        icon: icons[key] || "solar:bolt-linear",
        status: dimStatus,
        content: isParsing ? undefined : content,
        span: (spans[key] || 1) as 1 | 2 | 3,
      };
    });
  }, [sections, status]);

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
          activeKey="console"
          onNavigate={(key) => console.log('Navigate to', key)}
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
    </DashboardLayout>
  );
}
