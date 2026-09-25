'use client';

import { AnalysisHero } from '@/components/templates/console/AnalysisHero';

export interface DashboardHeaderProps {
  url: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  onUrlChange: (url: string) => void;
  onAnalyze: () => void;
  onReanalyze: () => void;
  onCancel: () => void;
  onDismissError?: () => void;
  error?: string;
  quota: string;
  isRepeat?: boolean;
}

export function DashboardHeader({
  url,
  status,
  onUrlChange,
  onAnalyze,
  onReanalyze,
  onCancel,
  onDismissError,
  error,
  quota,
  isRepeat = false,
}: DashboardHeaderProps) {
  return (
    <AnalysisHero
      url={url}
      status={status}
      onUrlChange={onUrlChange}
      onAnalyze={onAnalyze}
      onReanalyze={onReanalyze}
      onCancel={onCancel}
      onDismissError={onDismissError}
      error={error}
      quota={quota}
      isRepeat={isRepeat}
    />
  );
}
