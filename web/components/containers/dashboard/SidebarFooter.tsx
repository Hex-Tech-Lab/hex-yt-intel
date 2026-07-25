'use client';

import { Avatar, IconButton } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import type { ConsoleProfile } from '@/lib/services/console-profile';

interface SidebarFooterProps {
  profile: ConsoleProfile;
  onSignOut: () => void;
}

export function SidebarFooter({ profile, onSignOut }: SidebarFooterProps) {
  // Avatar derives initials from `name` by taking the first letter of each
  // whitespace-separated word (falls back to a single letter for a
  // single-word string — e.g. an email has no space and would collapse to
  // "K"). profile.initials is already computed correctly upstream, so we
  // reconstruct a two-word string whose per-word first letters reproduce it
  // exactly, rather than letting Avatar re-derive (and mangle) initials from
  // the raw email.
  const avatarName = profile.initials.length >= 2
    ? `${profile.initials[0]} ${profile.initials.slice(1)}`
    : profile.initials;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <Avatar name={avatarName} alt={profile.email} size={32} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile.email.split('@')[0]}
        </span>
        <span style={{ fontSize: 11, color: 'var(--ink-secondary)', textTransform: 'capitalize' }}>
          {profile.tier} Tier
        </span>
      </div>
      <IconButton
        variant="ghost"
        size="sm"
        label="Sign Out"
        tooltip="Sign Out"
        icon={<Icon icon="solar:logout-3-linear" size={16} />}
        onClick={onSignOut}
      />
    </div>
  );
}
