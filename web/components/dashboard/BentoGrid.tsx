'use client';

import { useMemo } from 'react';
import { parseUCISSections } from '@/lib/utils/ucis-parser';
import type { CachedAnalysisResult } from '@/lib/services/cache';

interface BentoGridProps {
  analysis: CachedAnalysisResult | null;
}

interface DimensionCardProps {
  title: string;
  icon: React.ReactNode;
  values: React.ReactNode;
  span?: 'col-span-1' | 'md:col-span-2' | 'md:col-span-3' | 'md:col-span-4' | 'md:col-span-6';
  glowColor?: string;
}

const DimensionCard = ({ title, icon, values, span = 'md:col-span-2', glowColor = 'bg-cyan-500/20' }: DimensionCardProps) => (
  <div 
    className={`${span} relative p-[1px] rounded-[2rem] overflow-hidden group transition-all duration-500 hover:translate-y-[-2px]`}
    style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 100%)' }}
  >
    <div className="bg-[#11141D] w-full h-full rounded-[calc(2rem-1px)] p-8 flex flex-col relative overflow-hidden">
      {/* Background Glows */}
      <div className={`absolute bottom-1/4 left-1/2 -translate-x-1/2 w-48 h-48 ${glowColor} rounded-full blur-[60px] pointer-events-none opacity-50 group-hover:opacity-80 transition-opacity duration-700`}>
      </div>
      <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-24 h-24 bg-white/10 rounded-full blur-[30px] pointer-events-none mix-blend-overlay">
      </div>

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl backdrop-blur-sm shadow-2xl">
            {icon}
          </div>
          <h3 className="text-sm font-medium text-white tracking-tight">{title}</h3>
        </div>
        
        <div className="flex-grow text-sm text-slate-400 leading-relaxed font-sans line-clamp-6 group-hover:line-clamp-none transition-all duration-500">
          {values}
        </div>

        <div className="mt-6 pt-4 border-t border-white/5 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">Dimension Verified</span>
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.6)]"></div>
        </div>
      </div>
    </div>
  </div>
);

export const BentoGrid = ({ analysis }: BentoGridProps) => {
  const sections = useMemo(() => {
    if (!analysis?.analysis_markdown) return null;
    return parseUCISSections(analysis.analysis_markdown);
  }, [analysis?.analysis_markdown]);

  if (!analysis) return null;

  const data = analysis.validation_report;
  const isMetadataOnly = data?.analysis_type === 'metadata-only';

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-1000">
      {isMetadataOnly && (
        <div className="relative p-[1px] rounded-2xl overflow-hidden bg-gradient-to-r from-amber-500/20 to-transparent">
          <div className="bg-amber-500/5 backdrop-blur-md border border-amber-500/10 rounded-[15px] p-4 flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.2)]">
              ⚠️
            </div>
            <p className="text-xs font-mono text-amber-200/80 tracking-wide uppercase">
              {data.warning || 'Insufficient Data: Analysis limited to visual profile and metadata'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-6 gap-6">
        <DimensionCard
          title="Apex Intelligence"
          icon="🔬"
          values={sections?.apex || 'Establishing neural link...'}
          span="md:col-span-2"
          glowColor="bg-cyan-500/30"
        />
        <DimensionCard
          title="Source Profile"
          icon="📡"
          values={sections?.provenance || 'Scanning origin point...'}
          span="md:col-span-4"
          glowColor="bg-teal-500/20"
        />
        <DimensionCard
          title="Content Architecture"
          icon="🏗️"
          values={sections?.architecture || 'Mapping logical structure...'}
          span="md:col-span-3"
          glowColor="bg-blue-500/20"
        />
        <DimensionCard
          title="Psychological Layer"
          icon="🧠"
          values={sections?.psychological || 'Decoding intent vectors...'}
          span="md:col-span-3"
          glowColor="bg-indigo-500/20"
        />
        
        {!isMetadataOnly && (
          <DimensionCard
            title="Core Insights"
            icon="⚡"
            values={sections?.coreIntelligence || 'Distilling intelligence...'}
            span="md:col-span-6"
            glowColor="bg-cyan-400/20"
          />
        )}

        <DimensionCard
          title="Risk & Integrity"
          icon="🛡️"
          values={sections?.risk || (data?.warning ? 'SYSTEM_DEGRADED: ANALYSIS_PARTIAL' : 'NOMINAL_INTEGRITY_CHECK_PASSED')}
          span="md:col-span-6"
          glowColor="bg-red-500/10"
        />
      </div>

      <details className="group mt-12">
        <summary className="flex items-center gap-2 text-[10px] font-mono text-slate-500 cursor-pointer hover:text-cyan-400 transition-colors uppercase tracking-[0.2em] list-none">
          <span className="w-4 h-px bg-slate-800 group-open:w-8 transition-all"></span>
          View Raw Neural Stream
        </summary>
        <div className="mt-6 relative p-[1px] rounded-xl overflow-hidden bg-white/5">
          <pre className="text-[11px] text-slate-400 whitespace-pre-wrap overflow-y-auto max-h-[40vh] font-mono bg-[#0D1017] p-8 rounded-[11px] leading-relaxed selection:bg-cyan-500/30">
            {analysis.analysis_markdown}
          </pre>
        </div>
      </details>
    </div>
  );
};

export default BentoGrid;
