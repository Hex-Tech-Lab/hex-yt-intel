/**
 * CombinerPass — Map-Reduce AST Combiner for Epistemic Dimension Chunks (Web)
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
  subsections: Map<string, ParsedSubSection>;
  rawTail?: string;
  /** True when the same sub-number appeared more than once and was merged. */
  hadDuplicateSubsections?: boolean;
}

export interface DimensionChunk {
  number: number;
  name?: string;
  content: string;
  [key: string]: unknown;
}

/**
 * Checks if a string contains no letters or numbers (symbol-only, glyphs, or separators).
 */
function isSymbolOnly(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/**
 * Checks whether `shorter` appears as a contiguous subsequence of whole tokens in `longer`.
 * Uses strict word/token boundaries so "$5" does not match "$50", and "15000" does not match "150000".
 */
function isTokenSubsequence(shorter: string, longer: string): boolean {
  const shortTokens = shorter.split(/\s+/).filter(Boolean);
  const longTokens = longer.split(/\s+/).filter(Boolean);
  if (shortTokens.length === 0 || shortTokens.length > longTokens.length) return false;

  for (let i = 0; i <= longTokens.length - shortTokens.length; i++) {
    let match = true;
    for (let j = 0; j < shortTokens.length; j++) {
      if (longTokens[i + j] !== shortTokens[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

/**
 * Normalizes text for comparison by stripping timestamps, approximate notes,
 * preserving distinct decimal separators, and collapsing whitespace.
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[\s*(?:\d{1,2}:\d{2}(?::\d{2})?[^\]]*|timestamp not provided[^\]]*)\s*\]/giu, '')
    .replace(/[[(]\s*approximate[^\])]*[\])]/giu, '')
    // Keep a leading minus sign (e.g. "-5%") so opposite-signed facts do not collapse.
    .replace(/(^|\s)-(?=\d)/gu, '$1minus')
    // Keep decimal separators between digits distinct (e.g. "3.14" vs "3,14")
    .replace(/(?<=\d)\.(?=\d)/gu, 'point')
    .replace(/(?<=\d),(?=\d)/gu, 'comma')
    .replace(/[^\p{L}\p{M}\p{N}\p{Sc}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Checks if text contains real, non-zero timestamps (e.g. `[01:23]`, `[00:45]`),
 * excluding placeholder zero timestamps like `[00:00]` or `[0:00]`.
 */
function hasRealTimestamps(text: string): boolean {
  const matches = text.match(/\[\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]/gu);
  if (!matches) return false;
  return matches.some((m) => /[1-9]/u.test(m));
}

/**
 * Matches subsection header line in various markdown and plain text formats.
 */
function matchSubHeader(line: string, dimNumber: number): { subNumber: string; title: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Only this dimension's own sub-numbers (e.g. 4.x inside dimension 4) count as
  // headers, so prose such as "1.5 - ..." inside dimension 4 stays body text.
  const ownSub = (subNumber: string) => subNumber.split('.')[0] === String(dimNumber);

  // Pattern 1: Markdown headings: #{1,6} [Dimension] X.Y [-:–—.] Title
  // e.g. "#### 2.1 Header Intelligence", "### Dimension 2.1: Title"
  const mdMatch = trimmed.match(/^#{1,6}\s*(?:Dimension\s+)?(\d+\.\d+)\s*[-:–—.]?\s*(.*)$/u);
  if (mdMatch?.[1] && ownSub(mdMatch[1])) {
    const rawTitle = (mdMatch[2] || '').trim();
    const cleanTitle = rawTitle.replace(/^\*{1,2}|\*{1,2}$/gu, '').replace(/^[-:–—.]\s*/u, '').trim();
    return { subNumber: mdMatch[1], title: cleanTitle };
  }

  // Pattern 2: Bold headings: **[Dimension ]X.Y Title** or **X.Y: Title** or **X.Y** Title
  const boldMatch = trimmed.match(/^\*{1,2}(?:Dimension\s+)?(\d+\.\d+)(?:\*{1,2})?\s*[-:–—.]?\s*(.*?)(?:\*{1,2})?:?$/u);
  if (boldMatch?.[1] && ownSub(boldMatch[1])) {
    const rawTitle = (boldMatch[2] || '').trim();
    const cleanTitle = rawTitle.replace(/^\*{1,2}|\*{1,2}$/gu, '').replace(/^[-:–—.]\s*/u, '').trim();
    return { subNumber: boldMatch[1], title: cleanTitle };
  }

  // Pattern 3: Plain text with delimiter: "X.Y: Title" or "X.Y - Title" or "Dimension X.Y: Title"
  const plainMatch = trimmed.match(/^(?:Dimension\s+)?(\d+\.\d+)\s*[-:–—.]\s*(.*)$/u);
  if (plainMatch?.[1] && ownSub(plainMatch[1])) {
    const rawTitle = (plainMatch[2] || '').trim();
    const cleanTitle = rawTitle.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim();
    return { subNumber: plainMatch[1], title: cleanTitle };
  }

  return null;
}

/**
 * Splits a markdown body into logical item blocks (numbered items, tier headings, paragraphs).
 */
function splitIntoBlocks(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const isNewItem = /^(\d+\.\s+|\*\*[^*]+\*\*:?$)/u.test(trimmed);
    if (isNewItem && currentBlock.length > 0) {
      blocks.push(currentBlock.join('\n').trim());
      currentBlock = [];
    }
    currentBlock.push(line);
  }
  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n').trim());
  }

  if (blocks.length <= 1) {
    return body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  }
  return blocks.filter(Boolean);
}

/**
 * Merges two subsection bodies, deduplicating identical or near-identical items/blocks,
 * upgrading placeholder timestamps when real timestamps are available, and appending
 * genuinely distinct new items.
 */
function mergeSubSectionBodies(existingBody: string, incomingBody: string): string {
  const trimmedExisting = existingBody.trim();
  const trimmedIncoming = incomingBody.trim();

  if (!trimmedExisting) return trimmedIncoming;
  if (!trimmedIncoming) return trimmedExisting;

  // 1. Full comparison after whitespace normalization
  const norm = (textVal: string) => textVal.trim().replace(/\s+/gu, ' ');
  if (norm(trimmedExisting) === norm(trimmedIncoming)) {
    return trimmedExisting;
  }

  // 2. Semantic comparison stripping timestamps & boilerplate
  // Skip whole-body semantic comparisons if either body is symbol-only (e.g. rating glyphs
  // "☆☆☆☆☆" vs "★★★★★"), so distinct symbol sequences are not falsely collapsed.
  if (!isSymbolOnly(trimmedExisting) && !isSymbolOnly(trimmedIncoming)) {
    const compExisting = normalizeForComparison(trimmedExisting);
    const compIncoming = normalizeForComparison(trimmedIncoming);

    if (compExisting && compIncoming) {
      if (compExisting === compIncoming) {
        // Exact semantic match: if incoming has real timestamps and existing does not, prefer incoming
        if (hasRealTimestamps(trimmedIncoming) && !hasRealTimestamps(trimmedExisting)) {
          return trimmedIncoming;
        }
        return trimmedExisting;
      }

      // 3. One is completely contained in the other with high length overlap (> 75%)
      const isContained =
        compExisting.length <= compIncoming.length
          ? isTokenSubsequence(compExisting, compIncoming)
          : isTokenSubsequence(compIncoming, compExisting);

      if (isContained) {
        const minLen = Math.min(compExisting.length, compIncoming.length);
        const maxLen = Math.max(compExisting.length, compIncoming.length);
        if (minLen / maxLen > 0.75) {
          if (hasRealTimestamps(trimmedIncoming) && !hasRealTimestamps(trimmedExisting)) {
            return trimmedIncoming;
          }
          return compExisting.length >= compIncoming.length ? trimmedExisting : trimmedIncoming;
        }
      }
    }
  }

  // 4. Block-level merge: split both into blocks and deduplicate each incoming block
  const existingBlocks = splitIntoBlocks(trimmedExisting);
  const incomingBlocks = splitIntoBlocks(trimmedIncoming);

  const mergedBlocks = [...existingBlocks];

  for (const inBlock of incomingBlocks) {
    if (isSymbolOnly(inBlock)) {
      // Symbol-only block (e.g. rating glyphs): nothing to compare semantically,
      // keep unless an exact identical block already exists.
      const alreadyPresent = mergedBlocks.some((b) => b.trim() === inBlock.trim());
      if (!alreadyPresent) {
        mergedBlocks.push(inBlock);
      } else {
        console.info('[CombinerPass] Dropped duplicate symbol-only block', {
          dropped: inBlock.trim(),
        });
      }
      continue;
    }

    const normIn = normalizeForComparison(inBlock);
    if (!normIn) {
      if (!mergedBlocks.includes(inBlock)) mergedBlocks.push(inBlock);
      continue;
    }

    let isDuplicate = false;
    let matchIdx = -1;

    for (let i = 0; i < mergedBlocks.length; i++) {
      const exBlock = mergedBlocks[i];
      if (!exBlock || isSymbolOnly(exBlock)) continue;
      const normEx = normalizeForComparison(exBlock);
      if (!normEx) continue;

      if (normEx === normIn) {
        isDuplicate = true;
        matchIdx = i;
        break;
      }

      const isContained =
        normEx.length <= normIn.length
          ? isTokenSubsequence(normEx, normIn)
          : isTokenSubsequence(normIn, normEx);

      if (isContained) {
        const minL = Math.min(normEx.length, normIn.length);
        const maxL = Math.max(normEx.length, normIn.length);
        if (minL / maxL > 0.75) {
          isDuplicate = true;
          matchIdx = i;
          break;
        }
      }
    }

    if (isDuplicate && matchIdx >= 0) {
      const exBlock = mergedBlocks[matchIdx]!;
      const incomingIsSuperset =
        normalizeForComparison(inBlock).length > normalizeForComparison(exBlock).length;
      const inHasReal = hasRealTimestamps(inBlock);
      const exHasReal = hasRealTimestamps(exBlock);

      let keptBlock: string;
      let droppedBlock: string;
      let reason: string;

      if (inHasReal && !exHasReal) {
        mergedBlocks[matchIdx] = inBlock;
        keptBlock = inBlock;
        droppedBlock = exBlock;
        reason = 'timestamp_upgrade';
      } else if (!inHasReal && exHasReal) {
        keptBlock = exBlock;
        droppedBlock = inBlock;
        reason = 'real_timestamp_retained';
      } else if (incomingIsSuperset) {
        mergedBlocks[matchIdx] = inBlock;
        keptBlock = inBlock;
        droppedBlock = exBlock;
        reason = 'superset_detail';
      } else {
        keptBlock = exBlock;
        droppedBlock = inBlock;
        reason = 'duplicate_dropped';
      }

      console.info('[CombinerPass] Dropped duplicate block in sub-section', {
        reason,
        dropped: droppedBlock.slice(0, 100),
        kept: keptBlock.slice(0, 100),
      });
    } else if (!isDuplicate) {
      mergedBlocks.push(inBlock);
    }
  }

  return mergedBlocks.join('\n\n').trim();
}

/**
 * CombinerPass — merges per-chunk dimension markdown into one AST per
 * dimension number (dedupes intros, merges subsection bodies), then
 * re-serializes to markdown; Dimension 7 additionally gets system-block
 * normalization (numbered `System N:` blocks with A–D subsection labels).
 */
export class CombinerPass {
  /** Parses one chunk's dimension markdown into (intro, subsections) AST form. */
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
    const introLines: string[] = [];

    let headerCount = 0;
    const saveSubSection = (numStr: string, title: string, bodyLines: string[]) => {
      const body = bodyLines.join('\n').trim();
      const existing = ast.subsections.get(numStr);
      if (!existing) {
        ast.subsections.set(numStr, {
          numberStr: numStr,
          title,
          body,
        });
      } else {
        existing.body = mergeSubSectionBodies(existing.body, body);
        if (!existing.title && title) {
          existing.title = title;
        }
      }
    };

    for (const line of lines) {
      const headerMatch = matchSubHeader(line, dimNumber);
      if (headerMatch) headerCount += 1;
      if (headerMatch) {
        if (currentSubNumber) {
          saveSubSection(currentSubNumber, currentSubTitle, currentSubLines);
          currentSubLines = [];
        } else if (introLines.length > 0) {
          ast.intro = introLines.join('\n').trim();
        }

        currentSubNumber = headerMatch.subNumber;
        currentSubTitle = headerMatch.title;
      } else {
        if (currentSubNumber) {
          currentSubLines.push(line);
        } else {
          introLines.push(line);
        }
      }
    }

    if (currentSubNumber) {
      saveSubSection(currentSubNumber, currentSubTitle, currentSubLines);
    } else if (introLines.length > 0) {
      ast.intro = introLines.join('\n').trim();
    }

    ast.hadDuplicateSubsections = headerCount > ast.subsections.size;
    return ast;
  }

  /** Normalizes Dimension 7 content into canonical `**System N: title**` blocks. */
  public static normalizeDimension7(content: string): string {
    if (!content.includes('System') && !content.includes('7.1')) {
      return content;
    }

    const systemSplitRegex = /(?:^|\n)\*{0,2}System(?:\s+\d+)?\s*:\s*\*?\*?\s*/iu;
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

      const firstLineEnd = trimmed.indexOf('\n');
      let title = firstLineEnd !== -1 ? trimmed.slice(0, firstLineEnd).trim() : trimmed;
      // Strip markdown bold first, then a balanced surrounding [pair] —
      // stripping brackets before bold left titles like "[System Alpha]"
      // with a trailing "]" (the ^\[|\]$ alternation only removes one side
      // when the other is wrapped in asterisks).
      title = title.replace(/^\*{1,2}|\*{1,2}$/gu, '').replace(/^\[(.*)\]$/u, '$1').trim();

      let body = firstLineEnd !== -1 ? trimmed.slice(firstLineEnd).trim() : '';

      body = body
        // Line-anchored ([ \t]*$/gim) so inline prose mentioning "Metrics" or
        // "Troubleshooting" mid-sentence is never rewritten as a subsection.
        .replace(/(?:^|\n)[ \t]*(?:[-*•][ \t]*)?(?:\*{0,2}(?:Step-by-[sS]tep [iI]mplementation|Implementation Steps):?\*{0,2})[ \t]*$/gimu, '\n\nA. Step-by-Step Implementation')
        .replace(/(?:^|\n)[ \t]*(?:[-*•][ \t]*)?(?:\*{0,2}(?:Success [mM]etrics|Metrics):?\*{0,2})[ \t]*$/gimu, '\n\nB. Success Metrics')
        .replace(/(?:^|\n)[ \t]*(?:[-*•][ \t]*)?(?:\*{0,2}(?:Common [pP]itfalls(?: & [tT]roubleshooting(?: [gG]uide)?)?|Troubleshooting):?\*{0,2})[ \t]*$/gimu, '\n\nC. Common Pitfalls & Troubleshooting')
        .replace(/(?:^|\n)[ \t]*(?:[-*•][ \t]*)?(?:\*{0,2}(?:Risk [fF]actors(?: & [mM]itigation)?|Risks & Mitigation):?\*{0,2})[ \t]*$/gimu, '\n\nD. Risk Factors & Mitigation');

      normalizedSystems.push(`**System ${systemIndex}: ${title}**\n\n${body.trim()}`);
      systemIndex++;
    }

    return [
      prefix ? prefix : '',
      ...normalizedSystems,
    ].filter(Boolean).join('\n\n');
  }

  /** Merges multiple chunks of the same dimension into one (intro dedupe, body merge). */
  public static combineDimensionChunks<T extends DimensionChunk>(dimNumber: number, chunks: T[]): T {
    if (chunks.length === 0) {
      return { number: dimNumber, content: '' } as T;
    }
    const base: T = chunks[0] ?? ({ number: dimNumber, content: '' } as T);
    const name = chunks.find((c) => c.name)?.name || base.name || `Dimension ${dimNumber}`;

    if (chunks.length === 1) {
      const single = chunks[0];
      if (!single) return { number: dimNumber, content: '' } as T;
      // Deduplicate any repeated subsections within the single chunk's own content
      const parsed = this.parseDimensionMarkdown(dimNumber, name, single.content);
      // Re-render only when a repeated sub-section was actually merged; otherwise
      // keep the single chunk's markdown unchanged (Dimension 7 still gets its normalization).
      if (parsed.hadDuplicateSubsections) {
        const outputLines: string[] = [];
        if (parsed.intro) {
          outputLines.push(parsed.intro);
          outputLines.push('');
        }
        const sortedSubKeys = Array.from(parsed.subsections.keys()).sort((a, b) => {
          const aParts = a.split('.').map(Number);
          const bParts = b.split('.').map(Number);
          return (aParts[1] ?? 0) - (bParts[1] ?? 0);
        });
        for (const subKey of sortedSubKeys) {
          const sub = parsed.subsections.get(subKey);
          if (!sub) continue;
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
          ...single,
          number: dimNumber,
          content: finalContent,
        };
      }
      let content = single.content;
      if (dimNumber === 7) {
        content = this.normalizeDimension7(content);
      }
      return {
        ...single,
        number: dimNumber,
        content,
      };
    }

    const combinedAst: ParsedDimensionAST = {
      number: dimNumber,
      name,
      subsections: new Map(),
    };

    const introSet = new Set<string>();

    for (const chunk of chunks) {
      const parsed = this.parseDimensionMarkdown(dimNumber, name, chunk.content);
      if (parsed.intro) {
        const compIntro = normalizeForComparison(parsed.intro);
        if (!introSet.has(compIntro)) {
          introSet.add(compIntro);
          if (!combinedAst.intro) {
            combinedAst.intro = parsed.intro;
          } else {
            combinedAst.intro += `\n\n${parsed.intro}`;
          }
        }
      }

      for (const [subKey, subSec] of parsed.subsections.entries()) {
        const existing = combinedAst.subsections.get(subKey);
        if (!existing) {
          combinedAst.subsections.set(subKey, { ...subSec });
        } else {
          existing.body = mergeSubSectionBodies(existing.body, subSec.body);
          if (!existing.title && subSec.title) {
            existing.title = subSec.title;
          }
        }
      }
    }

    const outputLines: string[] = [];
    if (combinedAst.intro) {
      outputLines.push(combinedAst.intro);
      outputLines.push('');
    }

    const sortedSubKeys = Array.from(combinedAst.subsections.keys()).sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      return (aParts[1] ?? 0) - (bParts[1] ?? 0);
    });

    for (const subKey of sortedSubKeys) {
      const sub = combinedAst.subsections.get(subKey);
      if (!sub) continue;
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
      ...base,
      number: dimNumber,
      name,
      content: finalContent,
    };
  }

  /** Groups raw chunks by dimension number and combines each group. */
  public static reduceDimensions<T extends DimensionChunk>(rawDimensions: T[]): T[] {
    const grouped = new Map<number, T[]>();

    for (const dim of rawDimensions) {
      if (!dim || typeof dim.number !== 'number') continue;
      const list = grouped.get(dim.number) || [];
      list.push(dim);
      grouped.set(dim.number, list);
    }

    const reduced: T[] = [];
    const sortedNumbers = Array.from(grouped.keys()).sort((a, b) => a - b);

    for (const num of sortedNumbers) {
      const chunks = grouped.get(num);
      if (!chunks) continue;
      reduced.push(this.combineDimensionChunks(num, chunks));
    }

    return reduced;
  }
}
