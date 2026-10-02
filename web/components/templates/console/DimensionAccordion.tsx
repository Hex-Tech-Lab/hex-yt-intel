'use client';

import { memo, useCallback, useRef } from 'react';
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
  onSelectDimension: (key: string | null) => void;
  progress?: string;
}

const DimensionItem = memo(
  function DimensionItem({
    d,
    index,
    isSelected,
    onSelect,
  }: {
    d: Dimension;
    index: number;
    isSelected: boolean;
    onSelect: (key: string) => void;
  }) {
    const isStreaming = d.status === 'streaming';
    const indexStr = String(index + 1).padStart(2, '0');
    const variant = isSelected ? 'selected' : 'default';
    const classMap = {
      selected: 'bg-[var(--accent-a04)] border-[var(--accent)] text-[var(--ink)] shadow-[0_0_15px_-3px_var(--accent-a15)]',
      default: 'bg-[var(--surface)] border-[var(--line-faint)] text-[var(--ink-secondary)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-raised)]/50',
    } as const;
    const buttonClass = classMap[variant];

    return (
      <GlowBorder
        active={isSelected || isStreaming}
        radius="card"
        className="w-full transition-all duration-300"
      >
        <CornerFrame tone={isSelected ? 'accent' : 'line'}>
          <button
            data-dimension-trigger="true"
            onClick={() => onSelect(d.key)}
            className={`w-full text-left flex items-center justify-between p-3 px-4 border cursor-pointer transition-all duration-200 ${buttonClass}`}
            style={{
              boxSizing: 'border-box',
              /* Corner-cut fix (2026-09-30): this button sits inside GlowBorder's
                 inner div (outer --radius-card 8px minus the 1px glow padding =
                 7px). A plain rounded-lg (8px) was LARGER than its container, so
                 overflow:hidden clipped the button's corners square — the
                 reported "cut off" look. Nested radius must be outer minus
                 border/padding. */
              borderRadius: 'calc(var(--radius-card) - 2px)',
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0 pl-1">
              <span className={`font-mono text-xs font-bold ${isSelected ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)]'}`}>
                {indexStr}
              </span>
              <span className={`w-7 h-7 rounded-lg border grid place-items-center flex-shrink-0 transition-all ${
                isSelected
                  ? 'bg-[var(--void)] border-[var(--accent)]/40 text-[var(--accent)]'
                  : 'bg-[var(--bg)] border-[var(--line)] text-[var(--ink-muted)]'
              }`}>
                <Icon icon={d.icon} size={14} />
              </span>
              <span className={`font-mono text-xs uppercase tracking-wider font-bold truncate ${isSelected ? 'text-[var(--accent-ink)]' : 'text-[var(--ink-secondary)]'}`}>
                {d.label}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 pr-1">
              <StatusBadge status={d.status} />
              <Icon
                icon="solar:alt-arrow-right-linear"
                size={14}
                className={`transition-transform duration-300 ${isSelected ? 'text-[var(--accent)] transform translate-x-1' : 'text-[var(--ink-muted)] opacity-40'}`}
              />
            </div>
          </button>
        </CornerFrame>
      </GlowBorder>
    );
  },
  (prev, next) => (
    prev.isSelected === next.isSelected &&
    prev.index === next.index &&
    prev.d.key === next.d.key &&
    prev.d.label === next.d.label &&
    prev.d.icon === next.d.icon &&
    prev.d.status === next.d.status &&
    prev.d.content === next.d.content &&
    prev.onSelect === next.onSelect
  )
);

export const DimensionAccordion = memo(
  function DimensionAccordion({
    dimensions,
    selectedDimensionKey,
    onSelectDimension,
    progress,
  }: DimensionAccordionProps) {
    const selectedKeyRef = useRef(selectedDimensionKey);
    selectedKeyRef.current = selectedDimensionKey;

    const handleSelect = useCallback(
      (key: string) => {
        onSelectDimension(selectedKeyRef.current === key ? null : key);
      },
      [onSelectDimension]
    );

    return (
      <section className="hx-rise flex flex-col gap-4">
        {/* One 16px rhythm: mt-3 + the parent's 4px gap above, gap-4 below. */}
        <div className="flex items-center justify-between mt-3">
          <MonoLabel index="//">synthesis dimensions</MonoLabel>
          {progress && (
            <span className="hx-mono text-[11px] tracking-wider text-[var(--accent-ink)] font-semibold">
              {progress}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {dimensions.map((d, i) => (
            <DimensionItem
              key={d.key}
              d={d}
              index={i}
              isSelected={selectedDimensionKey === d.key}
              onSelect={handleSelect}
            />
          ))}
        </div>
      </section>
    );
  },
  (prev, next) => (
    prev.selectedDimensionKey === next.selectedDimensionKey &&
    prev.progress === next.progress &&
    prev.dimensions === next.dimensions &&
    prev.onSelectDimension === next.onSelectDimension
  )
);
