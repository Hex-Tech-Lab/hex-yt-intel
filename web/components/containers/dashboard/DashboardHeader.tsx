'use client';

import { AnalysisHero } from '@/components/templates/console/AnalysisHero';

export interface DashboardHeaderProps {
  url: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  onUrlChange: (url: string) => void;
  onAnalyze: () => void;
  onReanalyze: () => void;
  onCancel: () => void;
  error?: string;
  quota: string;
}

export function DashboardHeader({
  url,
  status,
  onUrlChange,
  onAnalyze,
  onReanalyze,
  onCancel,
  error,
  quota,
}: DashboardHeaderProps) {
  return (
    <AnalysisHero
      url={url}
      status={status}
      onUrlChange={onUrlChange}
      onAnalyze={onAnalyze}
      onReanalyze={onReanalyze}
      onCancel={onCancel}
      error={error}
      quota={quota}
    />
  );
}
