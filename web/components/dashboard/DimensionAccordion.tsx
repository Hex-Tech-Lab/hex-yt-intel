'use client';

import { DimensionAccordion as BaseAccordion, type Dimension } from '@/components/templates/console/DimensionAccordion';
import { Icon } from '@/components/templates/_shared/primitives';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { TOTAL_DIMENSIONS } from '@/lib/config/synthesis';

interface DimensionAccordionProps {
  dimensions: Dimension[];
  selectedDimensionKey: string | null;
  onSelectDimension: (key: string | null) => void;
  status: string;
}

export function DimensionAccordion({
  dimensions,
  selectedDimensionKey,
  onSelectDimension,
  status,
}: DimensionAccordionProps) {
  const error = useAnalysisStore((store) => store.error);
  const missingDimensions = error?.missingDimensions;
  const hasPartialProgress = Array.isArray(missingDimensions) && missingDimensions.length > 0 && missingDimensions.length < TOTAL_DIMENSIONS;

  // RCA (2026-09-13, live video gKgWYFOhZx0): this label was hardcoded to
  // '100% complete' whenever status==='complete', regardless of how many
  // dimensions actually carry content. The live stream settles 'complete'
  // with as few as ONE successful bundle (useSSEStream's checkSettleState),
  // and the persisted row for the reported incident held 6 of 11 dimensions
  // (billing_status 'failed') — while this header simultaneously claimed
  // '100% complete' and the aux chips showed their real gray/done states.
  // Derive the label from the rendered list instead: only an actually-full
  // analysis says '100% complete'; a partial one states its real coverage.
  const completedCount = dimensions.filter(
    (d) => d.status === 'done' || (typeof d.content === 'string' && d.content.trim().length > 0),
  ).length;

  if (dimensions.length > 0) {
    return (
      <div className="flex flex-col gap-4">
        <BaseAccordion
          dimensions={dimensions}
          selectedDimensionKey={selectedDimensionKey}
          onSelectDimension={onSelectDimension}
          progress={
            status === 'analyzing'
              ? 'Processing...'
              : status === 'complete'
                ? completedCount === TOTAL_DIMENSIONS
                  ? '100% complete'
                  : `${completedCount}/${TOTAL_DIMENSIONS} dimensions`
                : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 text-center border border-dashed border-[var(--line)] rounded-2xl bg-[var(--surface-raised)]/30">
      {status === 'complete' ? (
        <p className="text-[var(--ink-secondary)] font-mono text-sm">No synthesis dimensions were produced for this analysis.</p>
      ) : status === 'error' && hasPartialProgress ? (
        <>
          <Icon icon="solar:refresh-linear" size={32} className="hx-anispin text-[var(--accent)] mb-4 inline-block" />
          <p className="text-[var(--ink-secondary)] font-mono text-sm">
            {TOTAL_DIMENSIONS - (missingDimensions as number[]).length} of {TOTAL_DIMENSIONS} sections finished before this analysis stopped.
            We&apos;re completing the rest automatically — check back shortly.
          </p>
        </>
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
