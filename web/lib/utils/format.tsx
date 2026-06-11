import React from 'react';

/**
 * Preprocesses markdown content from the assistant to convert non-standard elements:
 * 1. Convert unicode bullets (•/●) into standard markdown list items (-).
 * 2. Translate tab-separated values into markdown pipe tables.
 */
export function preprocessMarkdown(content: string): string {
  if (!content) return '';

  let processed = content;

  // 1. Convert unicode bullet points at the start of a line or after tab/pipe
  processed = processed.replace(/^[ \t]*[•●]\s*/gm, '- ');
  processed = processed.replace(/\t[ \t]*[•●]\s*/g, '\t- ');
  processed = processed.replace(/\|[ \t]*[•●]\s*/g, '| - ');

  // 2. Detect and transform tab-separated lines into pipe-separated tables
  const lines = processed.split('\n');
  let inTable = false;
  let tableHeaderIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
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
  const ansiRegex = /(?:\\x1b|\\u001b|\\033|[\u001b])\[([0-9;]*)m/g;

  if (!ansiRegex.test(text)) {
    return text;
  }

  ansiRegex.lastIndex = 0;

  const result: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentStyle: React.CSSProperties = {};
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    const textSegment = text.slice(lastIndex, match.index);
    if (textSegment) {
      if (Object.keys(currentStyle).length > 0) {
        result.push(
          <span key={lastIndex} style={{ ...currentStyle }}>
            {textSegment}
          </span>
        );
      } else {
        result.push(textSegment);
      }
    }

    const code = match[1] || '0';
    if (code === '0') {
      currentStyle = {};
    } else {
      const styles = code.split(';');
      for (const s of styles) {
        switch (s) {
          case '30': currentStyle.color = '#000000'; break;
          case '31': currentStyle.color = '#ef4444'; break; // red-500
          case '32': currentStyle.color = '#22c55e'; break; // green-500
          case '33': currentStyle.color = '#eab308'; break; // yellow-500
          case '34': currentStyle.color = '#3b82f6'; break; // blue-500
          case '35': currentStyle.color = '#a855f7'; break; // purple-500
          case '36': currentStyle.color = '#06b6d4'; break; // cyan-500
          case '37': currentStyle.color = '#ffffff'; break;
          case '90': currentStyle.color = '#6b7280'; break; // gray-500
          case '1': currentStyle.fontWeight = 'bold'; break;
          case '4': currentStyle.textDecoration = 'underline'; break;
        }
      }
    }
    lastIndex = ansiRegex.lastIndex;
  }

  const remainingText = text.slice(lastIndex);
  if (remainingText) {
    if (Object.keys(currentStyle).length > 0) {
      result.push(
        <span key={lastIndex} style={{ ...currentStyle }}>
          {remainingText}
        </span>
      );
    } else {
      result.push(remainingText);
    }
  }

  return result;
}
