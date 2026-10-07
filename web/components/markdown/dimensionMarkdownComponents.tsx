import { TimestampLink } from '@/components/TimestampLink';
import type React from 'react';

/**
 * Formats a raw seconds string as M:SS or H:MM:SS (matching the forms
 * linkifyTimestamps accepts) for use in aria-labels when the rendered
 * link text isn't a plain timestamp.
 */
function formatSecondsAsTimestamp(seconds: string): string {
  const n = parseInt(seconds, 10);
  if (Number.isNaN(n) || n < 0) return seconds;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
    // linkifyTimestamps encodes the raw seconds in the href but renders the
    // original human form (e.g. `1:23`) as the link text. For accessibility,
    // prefer the rendered text as the label when it looks like a timestamp
    // (guards against text that was mangled/truncated by other transforms);
    // otherwise fall back to the canonical M:SS/HH:MM:SS derived from seconds.
    const text = typeof children === 'string' ? children.trim() : '';
    const timestamp = /^\d{1,2}(:\d{2}){1,2}$/.test(text) ? text : formatSecondsAsTimestamp(seconds);
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
