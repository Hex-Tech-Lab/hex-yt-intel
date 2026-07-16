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

  return lines.join('\n');
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
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-black');
            break;
          case '31':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-red-500');
            break;
          case '32':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-green-500');
            break;
          case '33':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-yellow-500');
            break;
          case '34':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-blue-500');
            break;
          case '35':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-purple-500');
            break;
          case '36':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-cyan-500');
            break;
          case '37':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
            currentClasses.push('text-white');
            break;
          case '90':
            currentClasses = currentClasses.filter(c => !c.startsWith('text-'));
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
