// Plain .ts (not .tsx) deliberately -- no JSX here. format.tsx re-exports
// this so unit tests can import it without pulling in JSX (this repo's
// vitest config has no react plugin, so JSX-bearing .tsx files can't be
// parsed by the test runner at all).

// Marker Astryx's inlinePlugins hook (ChatDock's chatInlinePlugins) matches
// to swap in an expand/collapse toggle -- see truncateCitationPoints below.
// U+27E6/U+27E7 (mathematical white square brackets) chosen because they're
// vanishingly unlikely to appear in real LLM prose, unlike ASCII brackets.
const EXPAND_MARKER_OPEN = '⟦EXPAND:';
const EXPAND_MARKER_CLOSE = '⟧';
export const EXPAND_MARKER_PATTERN = /⟦EXPAND:([^⟧]*)⟧/g;

const CITATION_POINT_TRUNCATE_AT = 140;

/**
 * Word-safe truncation of a citation table's "Point" column, string-level
 * and BEFORE Astryx ever renders it -- not a CSS visual clamp. Astryx's
 * TableCell renders plain text as a bare text node with no wrapper
 * (confirmed against @astryxdesign/core's bundle), so no CSS selector can
 * target it for `-webkit-line-clamp`; and `chat-answer-table` is also used
 * for the transcript table, where chat-grounding's prompt contract requires
 * every quoted line shown in full -- a blind visual clamp there would
 * silently truncate grounded content (both issues found in PR #177 review).
 *
 * Only touches rows under a `| Timestamp | Point |` header (the citation
 * table shape chat-grounding.ts's prompt specifies) -- the transcript
 * table has a different header, so it's structurally never matched, no
 * runtime type-detection needed. Cut text is percent-encoded into an
 * `⟦EXPAND:...⟧` marker that ChatDock's inlinePlugins hook renders as a
 * real "…more" toggle (Astryx's already-shipped extension point, verified
 * live to fire inside table cells) -- the full text is simply absent from
 * the DOM until requested, same as a Facebook/X "See more", never hidden
 * with CSS overflow.
 */
// Splits a table row on unescaped `|` only -- a naive `line.split('|')`
// would treat a markdown-escaped `\|` inside cell content as a real column
// delimiter, shifting which cell is actually the Point column and emitting
// the escaped fragment as a spurious extra column (cubic review, PR #177).
function splitTableRow(line: string): string[] {
  return line.split(/(?<!\\)\|/);
}

export function truncateCitationPoints(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.split(/\r?\n/);
  const isPointHeader = (line: string) =>
    /^\|\s*timestamp\s*\|\s*point\s*\|$/i.test(line.trim());
  const isDelimiterRow = (line: string) => /^\|[ \t|:-]+\|$/.test(line.trim());
  const isTableRow = (line: string) => line.trim().startsWith('|') && line.trim().endsWith('|');

  // DeepSource flagged the earlier `lines[i]!` non-null assertions -- using
  // `?? ''` at each read instead avoids asserting past what TS already
  // knows is possibly undefined, with no behavior change (an out-of-range
  // index reading as '' fails isPointHeader/isDelimiterRow/isTableRow the
  // same way undefined would have).
  let inFence = false;
  for (let i = 0; i < lines.length - 1; i++) {
    const headerLine = lines[i] ?? '';
    // A fenced code example that happens to contain a citation-table-shaped
    // header must not be truncated -- it's a code sample, never rendered
    // citation content (cubic review, PR #177).
    if (headerLine.trim().startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const delimiterLine = lines[i + 1] ?? '';
    if (!isPointHeader(headerLine) || !isDelimiterRow(delimiterLine)) continue;
    let j = i + 2;
    while (j < lines.length && isTableRow(lines[j] ?? '')) {
      const cells = splitTableRow(lines[j] ?? '');
      // cells[0] is '' (before the leading |), cells[1] is Timestamp,
      // cells[2] is Point, cells[3] is '' (after the trailing |).
      const point = (cells[2] ?? '').trim();
      if (point.length > CITATION_POINT_TRUNCATE_AT && !point.includes(EXPAND_MARKER_OPEN)) {
        let cut = point.lastIndexOf(' ', CITATION_POINT_TRUNCATE_AT);
        if (cut <= 0) cut = CITATION_POINT_TRUNCATE_AT;
        const head = point.slice(0, cut).trimEnd();
        const rest = point.slice(cut);
        cells[2] = ` ${head} ${EXPAND_MARKER_OPEN}${encodeURIComponent(rest)}${EXPAND_MARKER_CLOSE} `;
        lines[j] = cells.join('|');
      }
      j++;
    }
    i = j - 1;
  }
  return lines.join('\n');
}
