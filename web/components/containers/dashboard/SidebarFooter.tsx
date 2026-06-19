'use client';

import { Icon } from '@/components/templates/_shared/primitives';
import type { ConsoleProfile } from '@/lib/services/console-profile';

interface SidebarFooterProps {
  profile: ConsoleProfile;
  onSignOut: () => void;
}

export function SidebarFooter({ profile, onSignOut }: SidebarFooterProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <div
        title={profile.email}
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: 'var(--accent-strong)',
          color: 'var(--void)',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 'bold',
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        {profile.initials}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile.email.split('@')[0]}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-secondary)', textTransform: 'capitalize' }}>
          {profile.tier} Tier
        </span>
      </div>
      <button
        type="button"
        onClick={onSignOut}
        title="Sign Out"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--ink-muted)',
          cursor: 'pointer',
          padding: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          transition: 'color var(--dur-fast), background var(--dur-fast)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--err)'; e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)'; e.currentTarget.style.background = 'transparent'; }}
      >
        <Icon icon="solar:logout-3-linear" size={16} />
      </button>
    </div>
  );
}
