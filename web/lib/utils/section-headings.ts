// A line that opens with a dimension section number and a short titled label,
// e.g. "8.1 Primary Knowledge Graph Nodes: 15 nodes are..." (optionally bolded).
// The title must start with a capital letter and stay short, so prose such as
// "3.5 million users: ..." is not mistaken for a section.
const SECTION_LINE = /^(?:\*\*)?(\d{1,2}\.\d{1,2})\s+([A-Z][^:\n*]{1,79}?)(?:\*\*)?:(?:\*\*)?(?:\s+(\S.*))?$/;

/**
 * Turns inline dimension subsection labels into real headings: the model
 * writes "3.1 Executive Overview: body..." on one line, which rendered as
 * plain paragraph text with no visual hierarchy (owner report T13). Each
 * such line becomes "#### 3.1 Executive Overview" followed by the body as
 * its own paragraph. Fenced code blocks and table rows are left untouched.
 */
export function promoteSectionHeadings(markdown: string): string {
  if (!markdown) return '';
  let inFence = false;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        inFence = !inFence;
        return line;
      }
      if (inFence || trimmed.startsWith('|')) return line;
      const match = trimmed.match(SECTION_LINE);
      if (!match) return line;
      const [, number, title, body] = match;
      const heading = `#### ${number} ${title!.trim()}`;
      return body ? `${heading}\n\n${body}` : heading;
    })
    .join('\n');
}
