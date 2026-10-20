import { stepFence, type OpenFence } from './markdown-table-width';

// A line that opens with a dimension section number and a short titled label,
// e.g. "8.1 Primary Knowledge Graph Nodes: 15 nodes are..." (optionally bolded).
// The title must start with a capital letter and stay short, so prose such as
// "3.5 million users: ..." is not mistaken for a section.
// A bolded "**System: RTK Installation**" (or "**System 4: ...**") label on its own line (Dim 7 lists
// several systems in a row and they ran together as one block, owner report).
const SYSTEM_LINE = /^\*\*System(?:\s+\d+)?\s*:\s*(.+?)\*\*:?$/u;

// A whole-line bold label without a colon: "**7.1 Implementation Systems**".
const BOLD_SECTION_LINE = /^\*\*(\d{1,2}\.\d{1,2})\s+([A-Z][^*\n]{1,79}?)\*\*$/u;

const SECTION_LINE = /^(?:\*\*)?(\d{1,2}\.\d{1,2})\s+([A-Z][^:\n*]{1,79}?)(?:\*\*)?:(?:\*\*)?(?:\s+(\S.*))?$/u;

/**
 * Turns inline dimension subsection labels into real headings: the model
 * writes "3.1 Executive Overview: body..." on one line, which rendered as
 * plain paragraph text with no visual hierarchy (owner report T13). Each
 * such line becomes "#### 3.1 Executive Overview" followed by the body as
 * its own paragraph. A "**System: Name**" line becomes a numbered
 * "##### System N: Name" heading (its own level, styled apart from the
 * N.N section headings), renumbered from 1 within each section even when
 * the model numbered them itself.
 * Fenced code blocks (``` or ~~~) and table rows are left
 * untouched.
 */
export function promoteSectionHeadings(markdown: string): string {
  if (!markdown) return '';
  let fence: OpenFence | null = null;
  let systemCount = 0;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      const step = stepFence(trimmed, fence);
      fence = step.open;
      // Indented code (4 spaces or a tab) is code, not a label.
      if (step.isDelimiter || fence || trimmed.startsWith('|') || /^(?: {4}|\t)/u.test(line)) return line;
      const system = trimmed.match(SYSTEM_LINE);
      if (system) {
        systemCount += 1;
        return `##### System ${systemCount}: ${(system[1] ?? '').trim()}`;
      }
      const bold = trimmed.match(BOLD_SECTION_LINE);
      if (bold) {
        systemCount = 0;
        return `#### ${bold[1] ?? ''} ${(bold[2] ?? '').trim()}`;
      }
      const match = trimmed.match(SECTION_LINE);
      if (!match) return line;
      systemCount = 0; // numbering restarts in each N.N section
      const [, number = '', title = '', body] = match;
      const heading = `#### ${number} ${title.trim()}`;
      return body ? `${heading}\n\n${body}` : heading;
    })
    .join('\n');
}
