'use client';

import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { parseUCISSections } from '@/lib/utils/ucis-parser';
import type { CachedAnalysisResult } from '@/lib/services/cache';

interface BentoGridProps {
  analysis: CachedAnalysisResult | null;
  isLoading?: boolean;
}

interface DimensionCardProps {
  title: string;
  icon: React.ReactNode;
  values: React.ReactNode;
  variant?: 'default' | 'secondary';
}

const DimensionCard = ({ title, icon, values, variant = 'default' }: DimensionCardProps) => (
  <Card
    className={`
      p-6 rounded-card border transition-all duration-300
      ${
        variant === 'secondary'
          ? 'bg-surface/50 border-border hover:border-accent/40 shadow-lg shadow-black/20'
          : 'bg-surface border-border hover:border-accent shadow-xl shadow-black/40'
      }
    `}
  >
    <div className="flex items-start gap-3 mb-4">
      <div className="w-10 h-10 rounded-control bg-accent/10 border border-accent/20 flex items-center justify-center text-lg flex-shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-xs font-mono font-semibold text-accent uppercase tracking-wider">{title}</h3>
      </div>
    </div>
    <div className="text-sm font-sans text-white/90 leading-relaxed">{values}</div>
  </Card>
);

export const BentoGrid = ({ analysis, isLoading }: BentoGridProps) => {
  const sections = useMemo(() => {
    if (!analysis?.analysis_markdown) return null;
    return parseUCISSections(analysis.analysis_markdown);
  }, [analysis?.analysis_markdown]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="h-40 bg-surface/50 border-border animate-pulse rounded-card" />
        ))}
      </div>
    );
  }

  if (!analysis) return null;

  const data = analysis.validation_report;
  const isMetadataOnly = data.analysis_type === 'metadata-only';

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {isMetadataOnly && (
        <div className="bg-accent/5 border border-accent/20 rounded-control p-4 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm font-mono text-accent">
            {data.warning || 'Index Miss: Analysis limited to metadata'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <DimensionCard
          title="Apex Intelligence"
          icon="🔬"
          values={sections?.apex || 'Parsing...'}
        />
        <DimensionCard
          title="Source Profile"
          icon="📡"
          values={sections?.provenance || 'Parsing...'}
        />
        <DimensionCard
          title="Content Architecture"
          icon="🏗️"
          values={sections?.architecture || 'Parsing...'}
        />
      </div>

      {!isMetadataOnly && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DimensionCard
              title="Psychological Layer"
              icon="🧠"
              values={sections?.psychological || 'Parsing...'}
            />
            <DimensionCard
              title="Core Insights"
              icon="⚡"
              values={sections?.coreIntelligence || 'Parsing...'}
            />
          </div>
        </>
      )}

      <div className="pt-4 border-t border-border">
        <h3 className="text-xs font-mono text-text-secondary uppercase tracking-widest mb-4">Risk Profile</h3>
        <DimensionCard
          title="Risk & Credibility"
          icon="🛡️"
          values={sections?.risk || (data.warning ? 'LIMITED_DATA_AVAILABILITY' : 'NOMINAL_INTEGRITY_CHECK_PASSED')}
          variant="secondary"
        />
      </div>

      <details className="mt-6 border-t border-border pt-4">
        <summary className="text-xs font-mono text-text-secondary cursor-pointer hover:text-accent">
          Full Report ↓
        </summary>
        <pre className="mt-4 text-xs text-white/60 whitespace-pre-wrap overflow-y-auto max-h-[50vh] font-mono bg-surface/30 p-4 rounded-control">
          {analysis.analysis_markdown}
        </pre>
      </details>
    </div>
  );
};

export default BentoGrid;
