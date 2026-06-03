'use client';

import { useAnalysisHistory } from '@/hooks/useAnalysisHistory';
import { Icon } from '@/components/templates/_shared/primitives';

export function AnalysisHistory() {
  const { items, isLoading, error } = useAnalysisHistory();

  if (isLoading) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        <Icon icon="solar:refresh-linear" size={24} style={{ animation: 'spin 2s linear infinite', display: 'inline-block', marginBottom: 16 }} />
        <p>Loading your analysis history...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        <Icon icon="solar:close-circle-linear" size={24} style={{ marginBottom: 16, color: 'var(--error)' }} />
        <p>{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-secondary)' }}>
        <Icon icon="solar:folder-open-linear" size={24} style={{ marginBottom: 16, opacity: 0.5 }} />
        <p>No analyses yet. Start by analyzing a YouTube video above.</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 80 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16, color: 'var(--ink)' }}>
          Analysis History ({items.length})
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid var(--line)',
                background: 'var(--surface)',
                cursor: 'pointer',
                transition: 'all var(--dur-base)',
              }}
              onMouseEnter={e => {
                const elem = e.currentTarget;
                elem.style.borderColor = 'var(--accent)';
                elem.style.background = 'rgb(6 182 212 / 0.05)';
              }}
              onMouseLeave={e => {
                const elem = e.currentTarget;
                elem.style.borderColor = 'var(--line)';
                elem.style.background = 'var(--surface)';
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{
                  fontSize: 14,
                  fontWeight: 500,
                  color: 'var(--ink)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  marginBottom: 4
                }}>
                  {item.title}
                </p>
                <p style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>
                  {new Date(item.createdAt).toLocaleDateString()} at {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginLeft: 16,
                flexShrink: 0
              }}>
                {item.status === 'completed' && (
                  <>
                    <Icon icon="solar:check-circle-linear" size={16} style={{ color: 'var(--success)' }} />
                    <span style={{ fontSize: 12, color: 'var(--success)', fontWeight: 500 }}>Done</span>
                  </>
                )}
                {item.status === 'processing' && (
                  <>
                    <Icon icon="solar:clock-linear" size={16} style={{ color: 'var(--warning)' }} />
                    <span style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 500 }}>Processing</span>
                  </>
                )}
                {item.status === 'incomplete' && (
                  <>
                    <Icon icon="solar-alert-circle-linear" size={16} style={{ color: 'var(--ink-secondary)' }} />
                    <span style={{ fontSize: 12, color: 'var(--ink-secondary)' }}>Incomplete</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
