export interface UCISSections {
  apex: string;
  provenance: string;
  architecture: string;
  psychological: string;
  coreIntelligence: string;
  risk: string;
}

function extractSection(markdown: string, dimensionNumber: number): string {
  // Match "### DIMENSION N –" or "### DIMENSION N -" with whitespace handling
  const dimensionRegex = new RegExp(
    `^### DIMENSION ${dimensionNumber}\\s*[–-](.+?)(?=^### DIMENSION|$)`,
    'msi'
  );

  const match = markdown.match(dimensionRegex);
  if (!match) {
    return 'Parsing...';
  }

  const content = match[1] || '';

  // Strip markdown syntax and clean up
  let cleaned = content
    .replace(/\*\*([^*]+)\*\*/g, '$1')           // Remove **bold**
    .replace(/__([^_]+)__/g, '$1')                // Remove __bold__
    .replace(/`([^`]+)`/g, '$1')                  // Remove `code`
    .replace(/^#+\s+/gm, '')                      // Remove heading markers
    .replace(/\|\s*[^|]+\s*\|/g, '')              // Remove table pipes
    .replace(/^---+$/gm, '')                      // Remove horizontal rules
    .replace(/^\s*[-*]\s+/gm, '')                 // Remove bullet points
    .replace(/\n\n+/g, '\n')                      // Collapse multiple blank lines
    .trim();

  // Extract first ~200 non-empty characters
  const lines = cleaned.split('\n').filter(line => line.trim());
  let snippet = '';
  for (const line of lines) {
    if (snippet.length >= 200) break;
    if (snippet) snippet += ' ';
    snippet += line.trim();
  }

  return snippet.slice(0, 200) || 'Parsing...';
}

export function parseUCISSections(markdown: string): UCISSections {
  if (!markdown || typeof markdown !== 'string') {
    return {
      apex: 'Parsing...',
      provenance: 'Parsing...',
      architecture: 'Parsing...',
      psychological: 'Parsing...',
      coreIntelligence: 'Parsing...',
      risk: 'Parsing...',
    };
  }

  return {
    apex: extractSection(markdown, 1),
    provenance: extractSection(markdown, 2),
    architecture: extractSection(markdown, 3),
    psychological: extractSection(markdown, 4),
    coreIntelligence: extractSection(markdown, 5),
    risk: extractSection(markdown, 10),
  };
}
