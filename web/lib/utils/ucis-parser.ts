import { type UCISDimension, DIMENSION_NAMES } from '@/lib/types/synthesis-nucleus';

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
 * Useful for restoring analyses from the database.
 */
export function parseToUCISDimensions(
  markdown: string | null | undefined,
): Record<number, UCISDimension> {
  const dimensions: Record<number, UCISDimension> = {};

  if (!markdown) return dimensions;

  for (let i = 1; i <= 11; i++) {
    const content = extractSection(markdown, i);
    if (content && content !== 'Parsing...') {
      dimensions[i] = {
        number: i,
        name: DIMENSION_NAMES[i] || `Dimension ${i}`,
        content,
      };
    }
  }

  return dimensions;
}

function extractSection(
  markdown: string | null | undefined,
  dimensionNumber: number,
): string {
  if (!markdown) return 'Parsing...';
  // Match "### DIMENSION N <sep> Title" then skip to content on next lines.
  // Tolerates optional **bold** markers and extra whitespace in the heading.
  const dimensionRegex = new RegExp(
    `^### DIMENSION ${dimensionNumber}\\s*[-–—:]\\s*\\*{0,2}[^\\n*]*?\\*{0,2}\\s*\\n([\\s\\S]*?)(?=\\n### DIMENSION|$)`,
    'mi'
  );

  const match = markdown.match(dimensionRegex);
  if (!match) {
    return 'Parsing...';
  }

  const content = match[1] || '';

  // Strip markdown syntax and clean up dimension numbering artifacts (e.g., 8.1, 10.1)
  let cleaned = content
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // Remove **bold**
    .replace(/__([^_]+)__/g, '$1')                // Remove __bold__
    .replace(/`([^`]+)`/g, '$1')                  // Remove `code`
    .replace(/^#+\s+/gm, '')                      // Remove heading markers
    .replace(/\b\d+\.\d+\s/g, '')                 // Strip artifacts like "8.1 ", "10.2 "
    .replace(/\|\s*[^|]+\s*\|/g, '')              // Remove table pipes
    .replace(/^---+$/gm, '')                      // Remove horizontal rules
    .replace(/^\s*[-*]\s+/gm, '')                 // Remove bullet points
    .replace(/End of UCIS.*Report/gim, '')       // Strip completion tags
    .replace(/\n\n+/g, '\n')                      // Collapse multiple blank lines
    .trim();

  return cleaned || 'Parsing...';
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
