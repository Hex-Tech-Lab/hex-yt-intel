'use client';

import { Icon } from '@/components/templates/_shared/primitives';

export interface DimensionDrawerProps {
  dimension: { label: string; content?: string; icon: string } | null;
  onClose: () => void;
}

export function DimensionDrawer({ dimension, onClose }: DimensionDrawerProps) {
  if (!dimension) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgb(0 0 0 / 0.4)',
          backdropFilter: 'blur(4px)',
          zIndex: 100,
          animation: 'fadeIn 0.2s ease-out',
        }}
      />

      {/* Drawer panel */}
      <div
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 'min(90vw, 480px)',
          background: 'var(--bg)',
          borderLeft: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 101,
          animation: 'slideInRight 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '1px solid var(--line)',
            background: 'rgb(17 20 29 / 0.6)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon icon={dimension.icon} size={16} />
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              {dimension.label}
            </span>
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{
              display: 'grid',
              placeItems: 'center',
              width: 32,
              height: 32,
              borderRadius: 6,
              border: 'none',
              background: 'transparent',
              color: 'var(--ink-secondary)',
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-secondary)')}
          >
            <Icon icon="solar:close-circle-linear" size={18} />
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {dimension.content ? (
            <div
              className="hx-body-secondary"
              style={{
                fontSize: 13.5,
                lineHeight: 1.7,
                color: 'var(--ink-secondary)',
                whiteSpace: 'pre-wrap',
                wordWrap: 'break-word',
              }}
            >
              {dimension.content}
            </div>
          ) : (
            <div style={{ color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              No content available.
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
