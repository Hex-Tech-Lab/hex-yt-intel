import type { CommentInsights } from '@/lib/types/comment-insights';

const SENTIMENT_ROWS = [
  { key: 'positive', label: 'Positive', color: 'var(--ok)' },
  { key: 'negative', label: 'Negative', color: 'var(--err)' },
  { key: 'neutral', label: 'Neutral', color: 'var(--ink-muted)' },
  { key: 'mixed', label: 'Mixed', color: 'var(--accent)' },
] as const;

export function formatScopeLine(insights: CommentInsights): string {
  const marginPct = (insights.marginOfError * 100).toFixed(1).replace(/\.0$/, '');
  const confidencePct = Math.round(insights.confidence * 100);
  return `Sampled pool: ${insights.sampleSize} of ${insights.population} comments fetched (YouTube returns up to ~2,000) · ±${marginPct}% at ${confidencePct}% confidence`;
}

const PANEL_STYLE = {
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'rgb(26 31 43 / 0.6)',
  padding: 16,
} as const;

const CHIP_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  borderRadius: 6,
  border: '1px solid var(--line)',
  padding: '3px 8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'var(--ink-secondary)',
} as const;

export function CommentInsightsCard({ insights }: { insights: CommentInsights }) {
  const total = insights.sentiment.positive + insights.sentiment.negative + insights.sentiment.neutral + insights.sentiment.mixed;
  const topTypes = Object.entries(insights.types)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div style={PANEL_STYLE} aria-label="Comment insights">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {SENTIMENT_ROWS.map(({ key, label, color }) => {
          const count = insights.sentiment[key];
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 64, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-secondary)' }}>
                {label}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 3,
                  background: 'var(--line)',
                  overflow: 'hidden',
                }}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pct)}
                aria-label={`${label} sentiment share`}
              >
                <div style={{ width: `${pct}%`, height: '100%', background: color }} />
              </div>
              <span style={{ width: 48, textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-muted)' }}>
                {Math.round(pct)}%
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {topTypes.map(([type, count]) => (
          <span key={type} style={CHIP_STYLE}>
            {type}: {count}
          </span>
        ))}
        <span style={CHIP_STYLE}>Pain points: {insights.painPointCount}</span>
        <span style={CHIP_STYLE}>Questions: {insights.questionCount}</span>
      </div>

      <p
        style={{
          marginTop: 12,
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--ink-muted)',
          lineHeight: 1.5,
        }}
      >
        <span>{formatScopeLine(insights)}</span>
        {insights.lowConfidence > 0 && <span> · {insights.lowConfidence} low-confidence classifications excluded</span>}
      </p>
    </div>
  );
}
