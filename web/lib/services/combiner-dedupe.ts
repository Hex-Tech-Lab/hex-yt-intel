/**
 * Combiner Deduplication and Comparison Helpers
 *
 * Domain service utilities for text normalization, token-boundary subsequence matching,
 * timestamp upgrade/preservation, and block-level deduplication used by CombinerPass.
 */

/**
 * Checks if a string contains no letters or numbers (symbol-only, glyphs, or separators).
 */
export function isSymbolOnly(text: string): boolean {
  return !/[\p{L}\p{N}]/u.test(text);
}

/**
 * Checks whether `shorter` appears as a contiguous subsequence of whole tokens in `longer`.
 * Uses strict word/token boundaries so "$5" does not match "$50", and "15000" does not match "150000".
 */
export function isTokenSubsequence(shorter: string, longer: string): boolean {
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
 * Checks if text contains real, non-zero timestamps (e.g. `[01:23]`, `[00:45]`),
 * excluding placeholder zero timestamps like `[00:00]` or `[0:00]`.
 */
export function hasRealTimestamps(text: string): boolean {
  const matches = text.match(/\[\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]/gu);
  if (!matches) return false;
  return matches.some((m) => /[1-9]/u.test(m));
}

/**
 * Extracts all real, non-zero timestamps from text in canonical order.
 */
export function extractRealTimestamps(text: string): string[] {
  const matches = text.match(/\[\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*\]/gu);
  if (!matches) return [];
  return matches.filter((m) => /[1-9]/u.test(m));
}

/**
 * Normalizes text for comparison by stripping placeholder timestamps,
 * preserving distinct decimal separators, keeping signed numbers, and collapsing whitespace.
 *
 * Real timestamps and hedges (e.g. "(approximate)") are kept as part of comparison text
 * so distinct mentions across timestamps or hedged statements do not falsely collapse.
 */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    // Strip timestamps: both real [12:40] and placeholder [timestamp not provided...]
    .replace(/\[\s*(?:\d{1,2}:\d{2}(?::\d{2})?[^\]]*|timestamp not provided[^\]]*)\s*\](?:\s*\(\s*approximate(?:;?[^)]*)?\))?/giu, '')
    // Keep minus signs (-, −, – when followed by digits) regardless of left context.
    .replace(/[-−–](?=\d)/gu, 'minus')
    // Keep decimal separators between digits distinct (e.g. "3.14" vs "3,14")
    .replace(/(?<=\d)\.(?=\d)/gu, 'point')
    .replace(/(?<=\d),(?=\d)/gu, 'comma')
    .replace(/[^\p{L}\p{M}\p{N}\p{Sc}\s]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/**
 * Matches subsection header line in various markdown and plain text formats.
 */
export function matchSubHeader(line: string, dimNumber: number): { subNumber: string; title: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // Only this dimension's own sub-numbers (e.g. 4.x inside dimension 4) count as
  // headers, so prose such as "1.5 - ..." inside dimension 4 stays body text.
  const ownSub = (subNumber: string) => subNumber.split('.')[0] === String(dimNumber);

  // Helper: validates that the candidate title looks like a header title,
  // not a numeric metric unit/suffix (e.g. "x", "-fold", "%").
  const isValidHeaderTitle = (title: string): boolean => {
    if (!title) return false;
    const firstWordMatch = title.match(/^[^\s]+/u);
    if (!firstWordMatch) return false;
    const firstWord = firstWordMatch[0];
    // Reject units, multipliers, and suffixes like "x", "fold", "-fold", "%", "percent"
    if (/^[-:–—.]?(?:x|fold|percent|%)[\w-]*$/iu.test(firstWord)) return false;
    return true;
  };

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
    if (isValidHeaderTitle(cleanTitle)) {
      return { subNumber: boldMatch[1], title: cleanTitle };
    }
  }

  // Pattern 3: Plain text with delimiter: "X.Y: Title" or "X.Y - Title" or "Dimension X.Y: Title"
  const plainMatch = trimmed.match(/^(?:Dimension\s+)?(\d+\.\d+)\s*[-:–—.]\s*(.*)$/u);
  if (plainMatch?.[1] && ownSub(plainMatch[1])) {
    const rawTitle = (plainMatch[2] || '').trim();
    const cleanTitle = rawTitle.replace(/^\*{1,2}|\*{1,2}$/gu, '').trim();
    if (isValidHeaderTitle(cleanTitle)) {
      return { subNumber: plainMatch[1], title: cleanTitle };
    }
  }

  return null;
}

/**
 * Splits a markdown body into logical item blocks (numbered items, tier headings, paragraphs).
 */
export function splitIntoBlocks(body: string): string[] {
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
export function mergeSubSectionBodies(existingBody: string, incomingBody: string): string {
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
      const existingReal = extractRealTimestamps(trimmedExisting);
      const incomingReal = extractRealTimestamps(trimmedIncoming);
      const timestampsConflict =
        existingReal.length > 0 &&
        incomingReal.length > 0 &&
        (existingReal.length !== incomingReal.length ||
          existingReal.some((timestampStr, i) => timestampStr !== incomingReal[i]));

      if (!timestampsConflict) {
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
              return compExisting.length > compIncoming.length ? trimmedExisting : trimmedIncoming;
            }
            return compExisting.length >= compIncoming.length ? trimmedExisting : trimmedIncoming;
          }
        }
      }
    }
  }

  // 4. Block-level merge: split both into blocks and deduplicate each incoming block
  const existingBlocks = splitIntoBlocks(trimmedExisting);
  const incomingBlocks = splitIntoBlocks(trimmedIncoming);

  const mergedBlocks = [...existingBlocks];
  let droppedCount = 0;

  for (const inBlock of incomingBlocks) {
    if (isSymbolOnly(inBlock)) {
      // Symbol-only block (e.g. rating glyphs): nothing to compare semantically,
      // keep unless an exact identical block already exists.
      const alreadyPresent = mergedBlocks.some((b) => b.trim() === inBlock.trim());
      if (!alreadyPresent) {
        mergedBlocks.push(inBlock);
      } else {
        droppedCount++;
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

      const exReal = extractRealTimestamps(exBlock);
      const inReal = extractRealTimestamps(inBlock);
      const blockTimestampsConflict =
        exReal.length > 0 &&
        inReal.length > 0 &&
        (exReal.length !== inReal.length || exReal.some((timestampStr, idx) => timestampStr !== inReal[idx]));

      if (blockTimestampsConflict) {
        continue;
      }

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
        if (!incomingIsSuperset && normalizeForComparison(exBlock).length > normalizeForComparison(inBlock).length) {
          keptBlock = exBlock;
          droppedBlock = inBlock;
          reason = 'superset_detail_retained';
        } else {
          mergedBlocks[matchIdx] = inBlock;
          keptBlock = inBlock;
          droppedBlock = exBlock;
          reason = 'timestamp_upgrade';
        }
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

      droppedCount++;
      console.info('[CombinerPass] Dropped duplicate block in sub-section', {
        reason,
        droppedChars: droppedBlock.length,
        keptChars: keptBlock.length,
      });
    } else if (!isDuplicate) {
      mergedBlocks.push(inBlock);
    }
  }

  if (droppedCount > 0) {
    console.info('[CombinerPass] Sub-section merge dropped blocks', { droppedCount });
  }
  return mergedBlocks.join('\n\n').trim();
}

