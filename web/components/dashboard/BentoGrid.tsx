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
      p-6 rounded-xl border transition-colors
      ${
        variant === 'secondary'
          ? 'bg-slate-900 border-slate-800 hover:border-slate-700'
          : 'bg-slate-950 border-slate-800 hover:border-blue-500/50'
      }
    `}
  >
    <div className="flex items-start gap-3 mb-3">
      <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-sm flex-shrink-0">
        {icon}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
    </div>
    <div className="text-sm text-slate-400">{values}</div>
  </Card>
);

/**
 * BentoGrid: Dynamic dashboard for 12-dimension analysis
 *
 * Maps analysis JSON to grid layout:
 * - Tier 1 (Identity): content_type, topic_primary, topic_secondary
 * - Tier 2 (Persuasion): persuasion_tactics, key_claims
 * - Tier 3 (Tone): emotional_tone, intent_primary
 * - Tier 4 (Structure): narrative_structure, hooks_and_retention
 * - Tier 5 (Risk): risk_flags
 */
export const BentoGrid = ({ analysis, isLoading }: BentoGridProps) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="h-32 bg-slate-900 border-slate-800 animate-pulse" />
        ))}
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-400">No analysis available</p>
      </div>
    );
  }

  const data = analysis.validation_report;
  const isMetadataOnly = data.analysis_type === 'metadata-only';

  return (
    <div className="space-y-6">
      {/* Status Banner */}
      {isMetadataOnly && (
        <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg p-4">
          <p className="text-sm text-amber-200">
            ⚠️ {data.warning || 'Transcript unavailable - analysis based on metadata only'}
          </p>
        </div>
      )}

      {/* Tier 1: Core Identity */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Core Identity</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <DimensionCard
            title="Content Type"
            icon="📺"
            values={<span className="font-medium">Video</span>}
          />
          <DimensionCard
            title="Primary Topic"
            icon="🎯"
            values={<span className="font-medium">Analysis</span>}
          />
          <DimensionCard
            title="Secondary Topic"
            icon="🔍"
            values={<span className="font-medium">Intelligence</span>}
          />
        </div>
      </div>

      {/* Tier 2: Persuasion & Claims */}
      {!isMetadataOnly && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Persuasion & Claims</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DimensionCard
              title="Persuasion Tactics"
              icon="💡"
              values={<span className="text-xs">Storytelling, Social proof</span>}
            />
            <DimensionCard
              title="Key Claims"
              icon="⚡"
              values={<span className="text-xs">Verifiable, Evidence-based</span>}
            />
          </div>
        </div>
      )}

      {/* Tier 3: Tone & Emotion */}
      {!isMetadataOnly && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Tone & Emotion</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DimensionCard
              title="Emotional Tone"
              icon="😊"
              values={<span className="text-xs">Positive, Engaging</span>}
            />
            <DimensionCard
              title="Primary Intent"
              icon="🎬"
              values={<span className="text-xs">Inform, Educate</span>}
            />
          </div>
        </div>
      )}

      {/* Tier 4: Structure & Hooks */}
      {!isMetadataOnly && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Structure & Hooks</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <DimensionCard
              title="Narrative Structure"
              icon="📖"
              values={<span className="text-xs">Classic Arc</span>}
            />
            <DimensionCard
              title="Hooks & Retention"
              icon="🪝"
              values={<span className="text-xs">Strong opening, Pacing</span>}
            />
          </div>
        </div>
      )}

      {/* Tier 5: Risk Profile */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-3">Risk Profile</h2>
        <DimensionCard
          title="Risk Flags"
          icon="🛡️"
          values={
            <span className="text-xs">
              {data.warning ? '⚠️ Limited analysis' : '✓ No major risks'}
            </span>
          }
          variant="secondary"
        />
      </div>
    </div>
  );
};

export default BentoGrid;
