'use client';

import { useState, useCallback } from 'react';
import { IconButton } from '@astryxdesign/core';
import { Icon } from '@/components/templates/_shared/primitives';
import { showToast } from '@/lib/dashboard/toast-bridge';

interface ShareButtonProps {
  analysisId: string;
}

interface ShareResponse {
  shareUrl: string;
  shortUrl: string | null;
  token: string;
  expiresAt: string;
}

/**
 * Real UI caller for POST /api/analyses/[id]/share (previously wired up
 * server-side with zero UI entry point anywhere in web/app or
 * web/components -- unreachable by a real user). Calls the route, copies the
 * best available link (Dub short link when Dub succeeded, otherwise the raw
 * /share/<token> URL the route always returns as a fallback) to the
 * clipboard, and confirms via the project's existing Astryx toast bridge.
 */
export function ShareButton({ analysisId }: ShareButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleShare = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/analyses/${analysisId}/share`, { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Share request failed: ${res.status}`);
      }
      const data: ShareResponse = await res.json();
      const linkToCopy = data.shortUrl ?? data.shareUrl;
      await navigator.clipboard.writeText(linkToCopy);
      showToast('Share link copied to clipboard', 'success');
    } catch (err) {
      console.error('[ShareButton] failed to create/copy share link:', err instanceof Error ? err.message : String(err));
      showToast('Failed to create share link', 'error');
    } finally {
      setLoading(false);
    }
  }, [analysisId, loading]);

  return (
    <IconButton
      label="Share"
      tooltip="Copy public share link"
      variant="ghost"
      size="sm"
      isDisabled={loading}
      icon={<Icon icon={loading ? 'solar:refresh-linear' : 'solar:share-linear'} size={16} className={loading ? 'animate-spin' : undefined} />}
      onClick={handleShare}
    />
  );
}
