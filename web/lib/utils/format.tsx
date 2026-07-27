import React from 'react';

/**
 * Preprocesses markdown content from the assistant to convert non-standard elements:
 * 1. Convert unicode bullets (•/●) into standard markdown list items (-).
 * 2. Translate tab-separated values into markdown pipe tables.
 */
export function preprocessMarkdown(content: string): string {
  if (!content) return '';

  let processed = content;

  // Normalize table delimiters if column count mismatches header
  const rawLines = processed.split(/\r?\n/);
  for (let i = 0; i < rawLines.length - 1; i++) {
    const line = rawLines[i]?.trim() || '';
    const nextLine = rawLines[i + 1]?.trim() || '';
    
    const isHeader = line.startsWith('|') && line.endsWith('|');
    const isDelimiter = nextLine.startsWith('|') && nextLine.endsWith('|') && /^[ \t|:-]+$/.test(nextLine);

    if (isHeader && isDelimiter) {
      const headerCols = line.split('|').filter(c => c.trim() !== '').length;
      const delimiterCols = nextLine.split('|').filter(c => c.trim() !== '').length;

      if (headerCols !== delimiterCols && headerCols > 0) {
        rawLines[i + 1] = '|' + Array(headerCols).fill('---').join('|') + '|';
      }
    }
  }
  processed = rawLines.join('\n');

  // 1. Convert unicode bullet points at the start of a line or after tab/pipe
  processed = processed.replace(/^[ \t]*[•●]\s*/gm, '- ');
  processed = processed.replace(/\t[ \t]*[•●]\s*/g, '\t- ');
  processed = processed.replace(/\|[ \t]*[•●]\s*/g, '| - ');

  // 2. Detect and transform tab-separated lines into pipe-separated tables
  const lines = processed.split(/\r?\n/);
  let inTable = false;
  let tableHeaderIndex = -1;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      if (inTable && tableHeaderIndex !== -1) {
        // Exited tab table due to code block start: insert separator
        const headerLine = lines[tableHeaderIndex]!;
        const colCount = headerLine.split('|').length - 2;
        if (colCount > 0) {
          const sep = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
          lines.splice(tableHeaderIndex + 1, 0, sep);
          i++;
        }
        inTable = false;
        tableHeaderIndex = -1;
      }
      continue;
    }

    if (inFence) {
      continue;
    }

    if (line.includes('\t')) {
      const parts = line.split('\t').map((p) => p.trim());
      lines[i] = '| ' + parts.join(' | ') + ' |';

      if (!inTable) {
        inTable = true;
        tableHeaderIndex = i;
      }
    } else {
      if (inTable && tableHeaderIndex !== -1) {
        // Exited tab table: insert the separator line right after the header
        const headerLine = lines[tableHeaderIndex]!;
        const colCount = headerLine.split('|').length - 2;
        if (colCount > 0) {
          const sep = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
          lines.splice(tableHeaderIndex + 1, 0, sep);
          i++; // adjust index for added separator
        }
        inTable = false;
        tableHeaderIndex = -1;
      }
    }
  }

  // Handle table ending at the end of the content
  if (inTable && tableHeaderIndex !== -1) {
    const headerLine = lines[tableHeaderIndex]!;
    const colCount = headerLine.split('|').length - 2;
    if (colCount > 0) {
      const sep = '| ' + Array(colCount).fill('---').join(' | ') + ' |';
      lines.splice(tableHeaderIndex + 1, 0, sep);
    }
  }

  let contentWithTables = lines.join('\n');
  contentWithTables = linkifyTimestamps(contentWithTables);

  return contentWithTables;
}

export function parseTimestampToSeconds(ts: string): number {
  const parts = ts.split(':').map(p => parseInt(p, 10)).filter(n => !isNaN(n));
  if (parts.length === 0) return 0;
  const multipliers = [3600, 60, 1];
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const mult = multipliers[multipliers.length - parts.length + i] || 1;
    total += (parts[i] || 0) * mult;
  }
  return total;
}

function findBacktickSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  let i = 0;
  while (i < line.length) {
    const start = line.indexOf('`', i);
    if (start === -1) break;
    const end = line.indexOf('`', start + 1);
    if (end === -1) break;
    spans.push([start, end]);
    i = end + 1;
  }
  return spans;
}

function findMarkdownLinkSpans(line: string): [number, number][] {
  const spans: [number, number][] = [];
  const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
  let m;
  while ((m = linkRegex.exec(line)) !== null) {
    spans.push([m.index, m.index + m[0].length - 1]);
  }
  return spans;
}

function isInsideSpan(offset: number, length: number, spans: [number, number][]): boolean {
  return spans.some(([start, end]) => offset >= start && offset + length - 1 <= end);
}

export function linkifyTimestamps(markdown: string): string {
  if (!markdown) return '';
  const lines = markdown.split('\n');
  let inFence = false;
  const out: string[] = [];

  const tsRegex = /(?:\[|\()?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\]|\))?/g;
  const isoDatePattern = /\d{4}-\d{2}-\d{2}/;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    // skip if line contains ISO datetime pattern (e.g. 2024-01-15T16:30:00)
    if (isoDatePattern.test(line)) {
      out.push(line);
      continue;
    }

    const backtickSpans = findBacktickSpans(line);
    const linkSpans = findMarkdownLinkSpans(line);

    const replaced = line.replace(tsRegex, (match, p1, offset) => {
      if (!p1) return match;
      const clean = p1.trim();
      if (match.includes('](#t=')) return match;

      // skip if inside backtick-delimited inline code
      if (isInsideSpan(offset, match.length, backtickSpans)) return match;
      // skip if inside existing markdown link [...](...)
      if (isInsideSpan(offset, match.length, linkSpans)) return match;

      // reject invalid time parts (seconds or minutes ≥ 60)
      const parts = clean.split(':');
      if (parts.length === 3) {
        const mm = parseInt(parts[1]!, 10);
        const ss = parseInt(parts[2]!, 10);
        if (mm >= 60 || ss >= 60) return match;
      } else if (parts.length === 2) {
        const mm = parseInt(parts[0]!, 10);
        const ss = parseInt(parts[1]!, 10);
        if (mm >= 60 || ss >= 60) return match;
      }

      const seconds = parseTimestampToSeconds(clean);
      if (seconds < 0 || seconds > 24 * 3600) return match;
      return `[⏱ ${clean}](#t=${seconds})`;
    });
    out.push(replaced);
  }
  return out.join('\n');
}

function filterTextClasses(classList: string[]): string[] {
  const keep: string[] = [];
  for (const itemClass of classList) {
    if (!itemClass.startsWith('text-')) keep.push(itemClass);
  }
  return keep;
}

/**
 * Parses ANSI escape codes (colors/formatting) in text and outputs React elements.
 */
export function parseAnsiToReact(text: string): React.ReactNode[] | string {
  if (typeof text !== 'string') return text;
  
  // Matches actual ESC sequence or literal escapes like \x1b, \u001b, \033
  const ansiRegex = /(?:\\x1b|\\u001b|\\033|\x1b)\[([0-9;]*)m/g;

  if (!ansiRegex.test(text)) {
    return text;
  }

  ansiRegex.lastIndex = 0;

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentClasses: string[] = [];
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    const textSegment = text.slice(lastIndex, match.index);
    if (textSegment) {
      if (currentClasses.length > 0) {
        result.push(
          <span key={lastIndex} className={currentClasses.join(' ')}>
            {textSegment}
          </span>
        );
      } else {
        result.push(textSegment);
      }
    }

    const code = match[1] || '0';
    if (code === '0') {
      currentClasses = [];
    } else {
      const styles = code.split(';');
      for (const s of styles) {
        switch (s) {
          case '30':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-black');
            break;
          case '31':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-red-500');
            break;
          case '32':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-green-500');
            break;
          case '33':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-yellow-500');
            break;
          case '34':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-blue-500');
            break;
          case '35':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-purple-500');
            break;
          case '36':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-cyan-500');
            break;
          case '37':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-white');
            break;
          case '90':
            currentClasses = filterTextClasses(currentClasses);
            currentClasses.push('text-gray-500');
            break;
          case '1':
            if (!currentClasses.includes('font-bold')) {
              currentClasses.push('font-bold');
            }
            break;
          case '4':
            if (!currentClasses.includes('underline')) {
              currentClasses.push('underline');
            }
            break;
          default:
            break;
        }
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remainingText = text.slice(lastIndex);
  if (remainingText) {
    if (currentClasses.length > 0) {
      result.push(
        <span key={lastIndex} className={currentClasses.join(' ')}>
          {remainingText}
        </span>
      );
    } else {
      result.push(remainingText);
    }
  }

  return result;
}
