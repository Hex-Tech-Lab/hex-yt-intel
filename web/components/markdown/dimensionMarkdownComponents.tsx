import { TimestampLink } from '@/components/TimestampLink';
import type React from 'react';

/**
 * Formats a raw seconds string as M:SS or H:MM:SS (matching the forms
 * linkifyTimestamps accepts) for use in aria-labels when the rendered
 * link text isn't a plain timestamp.
 */
function formatSecondsAsTimestamp(seconds: string): string {
  const total = parseInt(seconds, 10);
  if (Number.isNaN(total) || total < 0) return seconds;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Shared Astryx `<Markdown>` `link` component override.
 *
 * Routes `#t=<seconds>` hrefs (produced by `linkifyTimestamps` in
 * `web/lib/utils/format.tsx`) through `TimestampLink` with `asButton`
 * (semantic `<button>` seek controls -- timestamp seeks are actions, not
 * navigation links),
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
    const seconds = href.replace('#t=', '');
    // The seek target MUST come from the href seconds only — the rendered
    // text is untrusted (may be mangled/truncated by other transforms) and
    // is used solely as the visible label.
    const timestamp = formatSecondsAsTimestamp(seconds);
    return <TimestampLink timestamp={timestamp} asButton>{children}</TimestampLink>;
  }
  // Real bug fix (automated review, PR #260): protocol-relative URLs
  // (`//host/path`) are valid external navigation targets in a browser but
  // didn't match the http(s)-only regex, so they'd open in the current tab
  // without noopener/noreferrer -- a real external-link-behavior gap, not
  // just a missed test case.
  const isExternal = /^(https?:)?\/\//i.test(href ?? '');
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
