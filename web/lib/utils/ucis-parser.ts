import { type UCISDimension, DIMENSION_NAMES } from '@/lib/types/dimension';

export interface UCISSections {
  apex: string;
  provenance: string;
  architecture: string;
  psychological: string;
  coreIntelligence: string;
  comparative: string;
  implementation: string;
  semantic: string;
  forward: string;
  credibility: string;
  monetization: string;
  risk: string; // Alias for credibility (Dimension 10)
}

/**
 * Parses raw analysis markdown into structured UCISDimension objects.
 * Uses a robust index-slicing approach that handles all formatting variations
 * (carriage returns, missing/varying separators, bold formatting).
 */
export function parseToUCISDimensions(
  markdown: string | null | undefined,
): Record<number, UCISDimension> {
  const out: Record<number, UCISDimension> = {};
  if (!markdown || !markdown.trim()) return out;

  // Match lines starting with "### DIMENSION N" (case-insensitive)
  const headerRegex = /^###\s+DIMENSION\s+(\d+)\b[^\n]*/gim;
  const matches: Array<{ number: number; index: number; length: number; name: string }> = [];
  
  let match;
  while ((match = headerRegex.exec(markdown)) !== null) {
    const number = parseInt(match[1] || '', 10);
    if (number >= 0 && number <= 11) {
      // Clean up the dimension name by removing the prefix and separators
      const name = match[0]
        .replace(/^###\s+DIMENSION\s+\d+\b/i, '')
        .replace(/^\s*[-–—:.]\s*/, '')
        .replace(/\*{2,}/g, '')
        .trim();
      
      matches.push({
        number,
        index: match.index,
        length: match[0].length,
        name: name || DIMENSION_NAMES[number] || `Dimension ${number}`
      });
    }
  }

  // Sort matches by their index in the document
  matches.sort((a, b) => a.index - b.index);

  // Slice content between headers
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const contentStart = m.index + m.length;
    const contentEnd = matches[i + 1]?.index ?? markdown.length;
    const content = markdown.slice(contentStart, contentEnd).trim();
    
    out[m.number] = {
      number: m.number,
      name: m.name,
      content,
    };
  }

  return out;
}

// Alias for SupabasePersistenceAdapter compatibility
export const parseUcisDimensions = parseToUCISDimensions;

function extractSection(
  markdown: string | null | undefined,
  dimensionNumber: number,
): string {
  if (!markdown) return 'Parsing...';
  const dims = parseToUCISDimensions(markdown);
  return dims[dimensionNumber]?.content || 'Parsing...';
}

export function parseUCISSections(markdown: string | null | undefined): UCISSections {
  if (!markdown || typeof markdown !== 'string') {
    const placeholder = 'Parsing...';
    return {
      apex: placeholder,
      provenance: placeholder,
      architecture: placeholder,
      psychological: placeholder,
      coreIntelligence: placeholder,
      comparative: placeholder,
      implementation: placeholder,
      semantic: placeholder,
      forward: placeholder,
      credibility: placeholder,
      monetization: placeholder,
      risk: placeholder,
    };
  }

  const cred = extractSection(markdown, 10);
  return {
    apex: extractSection(markdown, 1),
    provenance: extractSection(markdown, 2),
    architecture: extractSection(markdown, 3),
    psychological: extractSection(markdown, 4),
    coreIntelligence: extractSection(markdown, 5),
    comparative: extractSection(markdown, 6),
    implementation: extractSection(markdown, 7),
    semantic: extractSection(markdown, 8),
    forward: extractSection(markdown, 9),
    credibility: cred,
    monetization: extractSection(markdown, 11),
    risk: cred,
  };
}
