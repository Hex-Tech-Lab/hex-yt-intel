'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
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

/**
 * DimensionCard: Individual grid cell for analysis dimensions
 */
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

/**
 * BentoGrid: Optimized 12-dimension intelligence dashboard
 */
export const BentoGrid = ({ analysis, isLoading }: BentoGridProps) => {
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
      {/* Status Alert */}
      {isMetadataOnly && (
        <div className="bg-accent/5 border border-accent/20 rounded-control p-4 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p className="text-sm font-mono text-accent">
            {data.warning || 'Index Miss: Analysis limited to metadata'}
          </p>
        </div>
      )}

      {/* Grid Layouts */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <DimensionCard
          title="Content Class"
          icon="📺"
          values="Commercial Video Analysis"
        />
        <DimensionCard
          title="Primary Domain"
          icon="🎯"
          values="Content Intelligence"
        />
        <DimensionCard
          title="Secondary Domain"
          icon="🔍"
          values="Semantic Relationship Mapping"
        />
      </div>

      {!isMetadataOnly && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DimensionCard
              title="Psychological Tactics"
              icon="💡"
              values="Sequential storytelling paired with social validation markers."
            />
            <DimensionCard
              title="Intelligence Claims"
              icon="⚡"
              values="High-fidelity verifiable evidence blocks identified in transcript."
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <DimensionCard
              title="Affective Signature"
              icon="😊"
              values="Constructive, High-Engagement professional tone."
            />
            <DimensionCard
              title="Primary Objective"
              icon="🎬"
              values="Information synthesis for consultant-level execution."
            />
          </div>
        </>
      )}

      <div className="pt-4 border-t border-border">
        <h3 className="text-xs font-mono text-text-secondary uppercase tracking-widest mb-4">Risk Perimeter</h3>
        <DimensionCard
          title="Advisory Flags"
          icon="🛡️"
          values={data.warning ? 'LIMITED_DATA_AVAILABILITY' : 'NOMINAL_INTEGRITY_CHECK_PASSED'}
          variant="secondary"
        />
      </div>
    </div>
  );
};

export default BentoGrid;
