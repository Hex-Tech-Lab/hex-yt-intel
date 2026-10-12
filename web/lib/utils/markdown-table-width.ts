/** An open fenced code block: its fence character and the length of its opening run. */
export interface OpenFence {
  char: '`' | '~';
  length: number;
}

/**
 * A pipe that is NOT escaped: preceded by an even number of backslashes (zero
 * included), so `\|` is escaped but `\\|` (an escaped backslash, then a
 * separator) is not.
 */
export const UNESCAPED_PIPE = /(?<=(?<!\\)(?:\\\\)*)\|/;

const UNESCAPED_TRAILING_PIPE = /(?<=(?<!\\)(?:\\\\)*)\|$/;

// A line that begins with a run of 3+ backticks or tildes, plus the rest of the line.
const FENCE_LINE = /^(`{3,}|~{3,})(.*)$/;

/**
 * Advances fenced-code tracking over one trimmed line. A fence is a run of 3+
 * backticks or tildes. A line opens a fence when none is open. While a fence is
 * open, only a fence of the same character, at least as long as the opening
 * run, with nothing but whitespace after it, closes it. Returns the new state
 * and whether the line is itself a fence delimiter; callers keep delimiters
 * as-is and skip any line while `open` is non-null.
 */
export function stepFence(
  trimmed: string,
  open: OpenFence | null,
): { open: OpenFence | null; isDelimiter: boolean } {
  const match = trimmed.match(FENCE_LINE);
  if (!match) return { open, isDelimiter: false };
  const run = match[1] ?? '';
  const rest = match[2] ?? '';
  const char: OpenFence['char'] = run[0] === '~' ? '~' : '`';
  if (!open) return { open: { char, length: run.length }, isDelimiter: true };
  const closes = char === open.char && run.length >= open.length && rest.trim() === '';
  return { open: closes ? null : open, isDelimiter: true };
}

/**
 * Splits a pipe-table row into trimmed cells. Escaped pipes (`\|`) do not
 * count as cell separators.
 */
function splitRowCells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(UNESCAPED_TRAILING_PIPE, '');
  const cells = inner.split(UNESCAPED_PIPE).map(cell => cell.trim());
  // A trailing empty cell ("| a | b | |") is padding, not content to merge.
  while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

/** True when a trimmed line starts and ends with a pipe, i.e. is a pipe-table row. */
const isTableRow = (row: string) => row.startsWith('|') && row.endsWith('|');

/** True when a trimmed line is a pipe-table delimiter row such as `|---|:--|`. */
const isDelimiterRow = (row: string) => isTableRow(row) && /^[ \t|:-]+$/.test(row);

/**
 * Pre-render normalisation for markdown pipe tables. For each table (header
 * row, dashed separator row, body rows), a body row with MORE cells than the
 * header has its extra cells merged into the LAST cell, joined as `\|` so the
 * literal pipe stays inside that cell. Rows with the header's cell count are
 * left untouched, and text outside tables is returned unchanged. Fenced code
 * blocks are skipped.
 */
export function normalizeTableRowWidth(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.split(/\r?\n/);
  let fence: OpenFence | null = null;

  for (let i = 0; i < lines.length - 1; i++) {
    const line = (lines[i] ?? '').trim();
    const step = stepFence(line, fence);
    fence = step.open;
    if (step.isDelimiter || fence) continue;
    const nextLine = (lines[i + 1] ?? '').trim();
    if (!isTableRow(line) || !isDelimiterRow(nextLine)) continue;

    const headerCount = splitRowCells(line).length;
    let j = i + 2;
    while (j < lines.length && isTableRow((lines[j] ?? '').trim())) {
      const cells = splitRowCells(lines[j] ?? '');
      if (cells.length > headerCount) {
        const merged = [
          ...cells.slice(0, headerCount - 1),
          cells.slice(headerCount - 1).join(' \\| '),
        ];
        lines[j] = `| ${merged.join(' | ')} |`;
      }
      j++;
    }
    i = j - 1; // skip past this table's body rows
  }
  return lines.join('\n');
}

// "| Engagement Rate | (3,524 + 324) / 237,282 x 100 = 1.62% |": the model
// shows its working; readers only need the result (owner report T14).
const RATE_ROW = /^(\s*\|\s*\**\s*engagement rate\s*\**\s*\|)([^|]*=\s*)([^|=]+?)\s*\|\s*$/iu;

/** Keeps only the computed value in an Engagement Rate table cell. */
export function stripRateFormula(markdown: string): string {
  if (!markdown) return '';
  let fence: OpenFence | null = null;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const step = stepFence(line.trim(), fence);
      fence = step.open;
      if (step.isDelimiter || fence) return line;
      return line.replace(RATE_ROW, (_row, label: string, _formula: string, value: string) => `${label} ${value.trim()} |`);
    })
    .join('\n');
}
