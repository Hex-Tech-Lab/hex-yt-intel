/**
 * Splits a pipe-table row into trimmed cells. Escaped pipes (`\|`) do not
 * count as cell separators.
 */
function splitRowCells(row: string): string[] {
  const inner = row.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return inner.split(/(?<!\\)\|/).map(cell => cell.trim());
}

const isTableRow = (row: string) => row.startsWith('|') && row.endsWith('|');
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
  let inFence = false;

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!isTableRow(line) || !isDelimiterRow(lines[i + 1]!.trim())) continue;

    const headerCount = splitRowCells(line).length;
    let j = i + 2;
    while (j < lines.length && isTableRow(lines[j]!.trim())) {
      const cells = splitRowCells(lines[j]!);
      if (cells.length > headerCount) {
        const merged = [
          ...cells.slice(0, headerCount - 1),
          cells.slice(headerCount - 1).join(' \\| '),
        ];
        lines[j] = '| ' + merged.join(' | ') + ' |';
      }
      j++;
    }
    i = j - 1; // skip past this table's body rows
  }
  return lines.join('\n');
}
