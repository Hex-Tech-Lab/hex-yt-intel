'use client';

import { MonoLabel, GlowBorder, Icon, CornerFrame, StatusBadge, type SynthesisStatus } from '@/components/templates/_shared/primitives';

export interface Dimension {
  key: string;
  label: string;
  icon: string;
  status: SynthesisStatus;
  content?: string;
  span?: 1 | 2 | 3;
}

interface DimensionAccordionProps {
  dimensions: Dimension[];
  selectedDimensionKey: string | null;
  onSelectDimension: (key: string) => void;
  progress?: string;
}

export function DimensionAccordion({
  dimensions,
  selectedDimensionKey,
  onSelectDimension,
  progress
}: DimensionAccordionProps) {
  return (
    <section className="hx-rise flex flex-col gap-4">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-2">
        <MonoLabel index="//">synthesis dimensions</MonoLabel>
        {progress && (
          <span className="hx-mono text-[11px] tracking-wider text-[var(--accent-ink)] font-semibold">
            {progress}
          </span>
        )}
      </div>

      {/* Accordion Slate List */}
      <div className="flex flex-col gap-3">
        {dimensions.map((d, i) => {
          const isSelected = selectedDimensionKey === d.key;
          const isStreaming = d.status === 'streaming';
          const indexStr = String(i + 1).padStart(2, '0');

          return (
            <GlowBorder
              key={d.key}
              active={isSelected || isStreaming}
              radius="card"
              className="w-full transition-all duration-300"
            >
              <CornerFrame tone={isSelected ? 'accent' : 'line'}>
                <button
                  onClick={() => onSelectDimension(d.key)}
                  className={`w-full text-left flex items-center justify-between p-4 px-5 rounded-[15px] border cursor-pointer transition-all duration-300 ${
                    isSelected
                      ? 'bg-[rgb(6_182_212_/_0.04)] border-[var(--accent)] text-[var(--ink)] shadow-[0_0_15px_-3px_rgba(6,182,212,0.15)]'
                      : 'bg-[var(--surface)] border-[var(--line-faint)] text-[var(--ink-secondary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)]/50'
                  }`}
                  style={{
                    boxSizing: 'border-box',
                  }}
                >
                  {/* Left Column: Number + Icon + Label */}
                  <div className="flex items-center gap-4 min-w-0">
                    <span className={`font-mono text-xs font-bold ${
                      isSelected ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'
                    }`}>
                      {indexStr}
                    </span>
                    
                    {/* Icon Container */}
                    <span className={`w-8 h-8 rounded-lg border grid place-items-center flex-shrink-0 transition-all ${
                      isSelected 
                        ? 'bg-[var(--void)] border-[var(--accent)]/40 text-[var(--accent)]' 
                        : 'bg-[var(--bg)] border-[var(--line)] text-[var(--ink-muted)]'
                    }`}>
                      <Icon icon={d.icon} size={16} />
                    </span>

                    {/* Label */}
                    <span className={`font-mono text-xs uppercase tracking-wider font-bold truncate ${
                      isSelected ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-secondary)]'
                    }`}>
                      {d.label}
                    </span>
                  </div>

                  {/* Right Column: Status + Selected Arrow Indicator */}
                  <div className="flex items-center gap-4 flex-shrink-0">
                    {/* Live status badge */}
                    <StatusBadge status={d.status} />

                    {/* Selection Indicator Arrow */}
                    <Icon
                      icon="solar:alt-arrow-right-linear"
                      size={14}
                      className={`transition-transform duration-300 ${
                        isSelected 
                          ? 'text-[var(--accent)] transform translate-x-1' 
                          : 'text-[var(--ink-muted)] opacity-40'
                      }`}
                    />
                  </div>
                </button>
              </CornerFrame>
            </GlowBorder>
          );
        })}
      </div>
    </section>
  );
}
