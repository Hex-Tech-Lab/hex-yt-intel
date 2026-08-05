'use client';



export interface SignalBarGroupProps {
  /** Score value from 0 to 10 or 0 to 100 */
  score?: number;
  /** Maximum score range, defaults to 10 */
  maxScore?: number;
  /** Optional custom label */
  label?: string;
  className?: string;
}

/**
 * SignalBarGroup Component (Item #5a presentation fix)
 * Renders 6 horizontal bars stepped/colored from orange (low 1-2) -> yellow (mid 3-4) -> green (high 5-6).
 * underlying weight algorithm is preserved, only presentation-layer color mapping is updated.
 */
export function SignalBarGroup({ score = 0, maxScore = 10, label, className = '' }: SignalBarGroupProps) {
  // Normalize score to 0..1 ratio
  const ratio = Math.max(0, Math.min(1, maxScore > 0 ? score / maxScore : 0));
  
  // 6 total bars
  const activeBars = Math.round(ratio * 6);

  // Step colors for 6 horizontal bars:
  // Bars 1-2: Low (Orange)
  // Bars 3-4: Mid (Yellow)
  // Bars 5-6: High (Green)
  const getBarColor = (barIndex: number, activeCount: number): string => {
    if (barIndex >= activeCount) {
      return 'bg-[var(--line-faint,rgba(255,255,255,0.08))] border-[var(--line,#1E293B)]';
    }
    if (barIndex < 2) {
      return 'bg-gradient-to-r from-orange-600 to-amber-500 border-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]';
    }
    if (barIndex < 4) {
      return 'bg-gradient-to-r from-amber-400 to-yellow-400 border-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.4)]';
    }
    return 'bg-gradient-to-r from-emerald-400 to-green-500 border-green-400 shadow-[0_0_8px_rgba(34,197,94,0.4)]';
  };

  return (
    <div className={`flex flex-col gap-1.5 font-mono ${className}`}>
      {label && (
        <div className="flex items-center justify-between text-[11px] text-[var(--ink-secondary)]">
          <span>{label}</span>
          <span className="font-bold text-[var(--ink)]">{score.toFixed(1)} / {maxScore}</span>
        </div>
      )}
      <div className="flex items-center gap-1 w-full h-3">
        {Array.from({ length: 6 }).map((_unused, barIndex) => (
          <div
            key={barIndex}
            className={`flex-1 h-full rounded-sm border transition-all duration-300 ${getBarColor(barIndex, activeBars)}`}
            title={`Signal step ${barIndex + 1} of 6`}
          />
        ))}
      </div>
    </div>
  );
}
