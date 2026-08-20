import { TimestampLink } from '@/components/TimestampLink';
import type React from 'react';

/**
 * Shared Astryx `<Markdown>` `link` component override.
 *
 * Routes `#t=<seconds>` hrefs (produced by `linkifyTimestamps` in
 * `web/lib/utils/format.tsx`) through `TimestampLink` (video-seek links),
 * and applies `target="_blank"` only to genuinely external `http(s)` links
 * -- a catch-all `target="_blank"` would also break relative/same-origin/
 * mailto/in-page links.
 *
 * Extracted from `SelectedDimensionReadout.tsx` and `ApexSummaryCard.tsx`,
 * which had this exact override duplicated (including inline comments) --
 * `ApexSummaryCard.tsx`'s version was copy-pasted from
 * `SelectedDimensionReadout.tsx`. See docs/TECH_DEBT_LEDGER.md, "2026-08-20
 * -- Highlights-reel redesign: /simplify findings deferred past merge",
 * item 2.
 *
 * Defined at module scope (not inside a component) so it isn't recreated
 * on every render.
 */
export function MarkdownLink({ href, children }: { href: string; children: React.ReactNode }) {
  if (href?.startsWith('#t=')) {
    const timestamp = href.replace('#t=', '');
    return <TimestampLink timestamp={timestamp}>{children}</TimestampLink>;
  }
  const isExternal = /^https?:\/\//i.test(href ?? '');
  return (
    <a
      href={href}
      className="text-[var(--accent)] hover:underline"
      {...(isExternal ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {children}
    </a>
  );
}
