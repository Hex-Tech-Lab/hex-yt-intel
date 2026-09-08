import { Icon } from "@/components/templates/_shared/primitives";

export interface PartialAnalysisInfo {
  presentCount: number;
  missing: number[];
}

interface PartialAnalysisWarningProps {
  partialInfo: PartialAnalysisInfo | null;
  totalDimensions: number;
}

/** Shared between Simple and Pro so both modes stay in sync on copy/style --
 *  same underlying analysis.analysis_markdown data drives both (see
 *  DashboardContainer.tsx's partialInfo memo), the previous divergence was a
 *  render gap, not a data gap (live-reported 2026-09-08). */
// skipcq: JS-0067
export const PartialAnalysisWarning = ({
  partialInfo,
  totalDimensions,
}: PartialAnalysisWarningProps) => {
  if (!partialInfo) return null;

  return (
    <div
      role="status"
      className="rounded-lg border border-[var(--warn)]/60 bg-[var(--warn)]/10 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--ink-main)] shadow-[0_0_14px_rgba(245,158,11,0.25)] flex items-center gap-2.5"
    >
      <Icon
        icon="solar:danger-triangle-linear"
        size={16}
        className="text-[var(--warn)] flex-shrink-0"
      />
      <div>
        <span className="font-mono font-bold text-[var(--warn)]">
          Partial analysis warning
        </span>
        {` — ${partialInfo.presentCount} of ${totalDimensions} dimensions generated. `}
        <span className="text-[var(--ink-muted)]">
          Missing: {partialInfo.missing.join(", ")}.
        </span>
        {" Use Re-analyze to attempt the rest."}
      </div>
    </div>
  );
};
