/**
 * CombinerPass — Map-Reduce AST Combiner for Epistemic Dimension Chunks
 *
 * Enforces:
 * 1. Strongly typed Map-Reduce Combiner pass parsing markdown into an AST schema before storage.
 * 2. Groups and deduplicates identical dimension sections across chunks (e.g., merging all 7.1 and 7.2
 *    chunks into a single canonical dimension body).
 * 3. Enforces sequential labeling for sub-entities: System 1: [Title], System 2: [Title], System 3: [Title].
 * 4. Normalizes subclauses to flat letters: A. Step-by-Step Implementation, B. Success Metrics, C. Pitfalls, D. Risk Factors.
 */

export interface ParsedSubSection {
  numberStr: string; // e.g. "7.1", "7.2"
  title: string;
  body: string;
}

export interface ParsedDimensionAST {
  number: number;
  name: string;
  intro?: string;
  subsections: Map<string, ParsedSubSection>; // key: "7.1", "7.2", etc.
  rawTail?: string;
}

export interface DimensionChunk {
  number: number;
  name?: string;
  content: string;
}

export class CombinerPass {
  /**
   * Parses dimension chunk markdown into an AST representation.
   */
  public static parseDimensionMarkdown(dimNumber: number, name: string, markdown: string): ParsedDimensionAST {
    const ast: ParsedDimensionAST = {
      number: dimNumber,
      name,
      subsections: new Map(),
    };

    if (!markdown || !markdown.trim()) {
      return ast;
    }

    const lines = markdown.split(/\r?\n/);
    let currentSubNumber = '';
    let currentSubTitle = '';
    let currentSubLines: string[] = [];
    let introLines: string[] = [];

    // Match headings like "#### 7.1 Implementation Systems" or "### 7.1 ..." or "## 7.1"
    const subHeaderRegex = /^#{2,4}\s+(\d+\.\d+)\s*[-:–—]?\s*(.*)$/;

    for (const line of lines) {
      const match = line.match(subHeaderRegex);
      if (match && match[1]) {
        // If we were already tracking a subsection, commit it
        if (currentSubNumber) {
          ast.subsections.set(currentSubNumber, {
            numberStr: currentSubNumber,
            title: currentSubTitle,
            body: currentSubLines.join('\n').trim(),
          });
          currentSubLines = [];
        } else if (introLines.length > 0) {
          ast.intro = introLines.join('\n').trim();
        }

        currentSubNumber = match[1];
        currentSubTitle = (match[2] || '').trim();
      } else {
        if (currentSubNumber) {
          currentSubLines.push(line);
        } else {
          introLines.push(line);
        }
      }
    }

    if (currentSubNumber) {
      ast.subsections.set(currentSubNumber, {
        numberStr: currentSubNumber,
        title: currentSubTitle,
        body: currentSubLines.join('\n').trim(),
      });
    } else if (introLines.length > 0) {
      ast.intro = introLines.join('\n').trim();
    }

    return ast;
  }

  /**
   * Normalizes Dimension 7 content:
   * - Deduplicates systems across chunks.
   * - Enforces sequential numbering: System 1: [Title], System 2: [Title], System 3: [Title].
   * - Normalizes subclauses to flat letters:
   *     A. Step-by-Step Implementation
   *     B. Success Metrics
   *     C. Common Pitfalls & Troubleshooting
   *     D. Risk Factors & Mitigation
   */
  public static normalizeDimension7(content: string): string {
    if (!content.includes('System') && !content.includes('7.1')) {
      return content;
    }

    // Split system blocks by "System" or "**System"
    const systemSplitRegex = /(?:^|\n)(?:\*{0,2}System(?:\s+\d+)?:?\s*\*?\*?\s*)/i;
    const parts = content.split(systemSplitRegex);

    if (parts.length <= 1) {
      return content;
    }

    const prefix = parts[0]?.trim();
    const systemBodies = parts.slice(1);
    const normalizedSystems: string[] = [];

    let systemIndex = 1;
    for (const rawBody of systemBodies) {
      const trimmed = rawBody.trim();
      if (!trimmed) continue;

      // Extract system title from first line
      const firstLineEnd = trimmed.indexOf('\n');
      let title = firstLineEnd !== -1 ? trimmed.slice(0, firstLineEnd).trim() : trimmed;
      title = title.replace(/^\[|\]$/g, '').replace(/^\*{1,2}|\*{1,2}$/g, '').trim();

      let body = firstLineEnd !== -1 ? trimmed.slice(firstLineEnd).trim() : '';

      // Normalize subclause headers to flat letters:
      // A. Step-by-Step Implementation
      // B. Success Metrics
      // C. Common Pitfalls & Troubleshooting
      // D. Risk Factors & Mitigation
      body = body
        .replace(/(?:^|\n)(?:[-*•]\s*)?(?:\*{0,2}(?:Step-by-[sS]tep [iI]mplementation|Implementation Steps):?\*{0,2})/gi, '\n\nA. Step-by-Step Implementation')
        .replace(/(?:^|\n)(?:[-*•]\s*)?(?:\*{0,2}(?:Success [mM]etrics|Metrics):?\*{0,2})/gi, '\n\nB. Success Metrics')
        .replace(/(?:^|\n)(?:[-*•]\s*)?(?:\*{0,2}(?:Common [pP]itfalls(?: & [tT]roubleshooting(?: [gG]uide)?)?|Troubleshooting):?\*{0,2})/gi, '\n\nC. Common Pitfalls & Troubleshooting')
        .replace(/(?:^|\n)(?:[-*•]\s*)?(?:\*{0,2}(?:Risk [fF]actors(?: & [mM]itigation)?|Risks & Mitigation):?\*{0,2})/gi, '\n\nD. Risk Factors & Mitigation');

      normalizedSystems.push(`**System ${systemIndex}: ${title}**\n\n${body.trim()}`);
      systemIndex++;
    }

    const reconstructed = [
      prefix ? prefix : '',
      ...normalizedSystems,
    ].filter(Boolean).join('\n\n');

    return reconstructed;
  }

  /**
   * Combines multiple chunk outputs for a given dimension into a single canonical dimension body.
   * Deduplicates identical subsections (e.g. merging multiple 7.1 chunks).
   */
  public static combineDimensionChunks(dimNumber: number, chunks: DimensionChunk[]): DimensionChunk {
    if (chunks.length === 0) {
      return { number: dimNumber, content: '' };
    }
    if (chunks.length === 1 && chunks[0]) {
      let content = chunks[0].content;
      if (dimNumber === 7) {
        content = this.normalizeDimension7(content);
      }
      return {
        number: dimNumber,
        name: chunks[0].name,
        content,
      };
    }

    const name = chunks.find((c) => c.name)?.name || `Dimension ${dimNumber}`;
    const combinedAst: ParsedDimensionAST = {
      number: dimNumber,
      name,
      subsections: new Map(),
    };

    const introSet = new Set<string>();

    for (const chunk of chunks) {
      const parsed = this.parseDimensionMarkdown(dimNumber, name, chunk.content);
      if (parsed.intro && !introSet.has(parsed.intro)) {
        introSet.add(parsed.intro);
        if (!combinedAst.intro) {
          combinedAst.intro = parsed.intro;
        } else {
          combinedAst.intro += `\n\n${parsed.intro}`;
        }
      }

      for (const [subKey, subSec] of parsed.subsections.entries()) {
        const existing = combinedAst.subsections.get(subKey);
        if (!existing) {
          combinedAst.subsections.set(subKey, { ...subSec });
        } else {
          // Merge body if non-identical
          if (!existing.body.includes(subSec.body)) {
            existing.body += `\n\n${subSec.body}`;
          }
        }
      }
    }

    // Reconstruct canonical markdown
    const outputLines: string[] = [];
    if (combinedAst.intro) {
      outputLines.push(combinedAst.intro);
      outputLines.push('');
    }

    // Sort subsections numerically: 7.1, 7.2, etc.
    const sortedSubKeys = Array.from(combinedAst.subsections.keys()).sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      return (aParts[1] ?? 0) - (bParts[1] ?? 0);
    });

    for (const subKey of sortedSubKeys) {
      const sub = combinedAst.subsections.get(subKey)!;
      outputLines.push(`#### ${sub.numberStr} ${sub.title}`);
      outputLines.push('');
      outputLines.push(sub.body);
      outputLines.push('');
    }

    let finalContent = outputLines.join('\n').trim();

    if (dimNumber === 7) {
      finalContent = this.normalizeDimension7(finalContent);
    }

    return {
      number: dimNumber,
      name,
      content: finalContent,
    };
  }

  /**
   * Map-reduce over a full list of raw dimensions from all chunk streams.
   * Groups by dimension number (1-11), merges duplicates, and sorts.
   */
  public static reduceDimensions(rawDimensions: DimensionChunk[]): DimensionChunk[] {
    const grouped = new Map<number, DimensionChunk[]>();

    for (const dim of rawDimensions) {
      if (!dim || typeof dim.number !== 'number') continue;
      const list = grouped.get(dim.number) || [];
      list.push(dim);
      grouped.set(dim.number, list);
    }

    const reduced: DimensionChunk[] = [];
    const sortedNumbers = Array.from(grouped.keys()).sort((a, b) => a - b);

    for (const num of sortedNumbers) {
      const chunks = grouped.get(num)!;
      reduced.push(this.combineDimensionChunks(num, chunks));
    }

    return reduced;
  }
}
