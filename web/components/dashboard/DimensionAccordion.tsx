'use client';

import { DimensionAccordion as BaseAccordion, type Dimension } from '@/components/templates/console/DimensionAccordion';
import { Icon } from '@/components/templates/_shared/primitives';

interface DimensionAccordionProps {
  dimensions: Dimension[];
  selectedDimensionKey: string | null;
  onSelectDimension: (key: string) => void;
  status: string;
}

export function DimensionAccordion({
  dimensions,
  selectedDimensionKey,
  onSelectDimension,
  status,
}: DimensionAccordionProps) {
  if (dimensions.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <BaseAccordion
          dimensions={dimensions}
          selectedDimensionKey={selectedDimensionKey}
          onSelectDimension={onSelectDimension}
          progress={status === 'analyzing' ? 'Processing...' : status === 'complete' ? '100% complete' : undefined}
        />
      </div>
    );
  }

  return (
    <div className="p-12 text-center border border-dashed border-[var(--line)] rounded-2xl bg-[var(--surface-raised)]/30">
      {status === 'complete' ? (
        <p className="text-[var(--ink-secondary)] font-mono text-sm">No synthesis dimensions were produced for this analysis.</p>
      ) : status === 'error' ? (
        <p className="text-[var(--danger,#ef4444)] font-mono text-sm">Synthesis failed — see the log below.</p>
      ) : (
        <>
          <Icon icon="solar:refresh-linear" size={32} className="hx-anispin text-[var(--accent)] mb-4 inline-block" />
          <p className="text-[var(--ink-secondary)] font-mono text-sm">Preparing synthesis dimensions…</p>
        </>
      )}
    </div>
  );
}
