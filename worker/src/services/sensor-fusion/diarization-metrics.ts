import type {
  DiarizationMetrics,
  WordDiarization,
} from '../../ports/DiarizationProviderPort';

/**
 * Shared native mathematical reduction over word-level timestamp intervals:
 * 1. speakerCount: cardinality of unique speaker indices.
 * 2. turnEntropy: Shannon entropy H = - \sum (p_i * log2(p_i)) over speaker speech durations.
 * 3. overlapRatio: sum of simultaneous speech intervals across different speakers divided by total speech time.
 */
export function calculateDiarizationMetrics(words: WordDiarization[]): DiarizationMetrics {
  if (!words || words.length === 0) {
    return {
      speakerCount: 0,
      turnEntropy: 0,
      overlapRatio: 0,
    };
  }

  const speakerDurations = new Map<number, number>();
  let totalSpeechDuration = 0;
  // Per-speaker merged (union) intervals, so overlapping words from one
  // speaker are counted once (true wall-clock speaking time).
  const speakerIntervals = new Map<number, Array<{ start: number; end: number }>>();

  for (const wordItem of words) {
    if (wordItem.end <= wordItem.start) continue;
    const intervals = speakerIntervals.get(wordItem.speaker);
    if (intervals) {
      intervals.push({ start: wordItem.start, end: wordItem.end });
    } else {
      speakerIntervals.set(wordItem.speaker, [{ start: wordItem.start, end: wordItem.end }]);
    }
  }

  for (const [speaker, intervals] of speakerIntervals) {
    intervals.sort((ivA, ivB) => ivA.start - ivB.start);
    let speakingTime = 0;
    let currentEnd = -Infinity;
    for (const interval of intervals) {
      if (interval.end > currentEnd) {
        speakingTime += interval.end - Math.max(interval.start, currentEnd);
        currentEnd = interval.end;
      }
    }
    speakerDurations.set(speaker, speakingTime);
    totalSpeechDuration += speakingTime;
  }

  const speakerCount = speakerDurations.size;

  // 1. Calculate Shannon turnEntropy: H = - sum(p_i * log2(p_i))
  let turnEntropy = 0;
  if (totalSpeechDuration > 0 && speakerCount > 1) {
    for (const duration of speakerDurations.values()) {
      const speechProbability = duration / totalSpeechDuration;
      if (speechProbability > 0) {
        turnEntropy -= speechProbability * Math.log2(speechProbability);
      }
    }
  }

  // 2. Calculate overlapRatio (cross-talk / simultaneous speech between different speakers),
  //    unioned per wall-clock instant so the same overlap is not double-counted
  //    across speaker pairs (N speakers active simultaneously count once, not C(N,2) times).
  let overlapDuration = 0;
  const overlapSegments: Array<{ start: number; end: number }> = [];

  for (const [speakerA, intervalsA] of speakerIntervals) {
    for (const [speakerB, intervalsB] of speakerIntervals) {
      if (speakerB <= speakerA) continue;
      let indexB = 0;
      for (const intervalA of intervalsA) {
        while (indexB < intervalsB.length && intervalsB[indexB]!.end <= intervalA.start) {
          indexB++;
        }
        for (let i = indexB; i < intervalsB.length; i++) {
          const intervalB = intervalsB[i]!;
          if (intervalB.start >= intervalA.end) break;
          const overlapStart = Math.max(intervalA.start, intervalB.start);
          const overlapEnd = Math.min(intervalA.end, intervalB.end);
          if (overlapEnd > overlapStart) {
            overlapSegments.push({ start: overlapStart, end: overlapEnd });
          }
        }
      }
    }
  }

  // Union the pairwise overlaps into disjoint wall-clock segments.
  overlapSegments.sort((segA, segB) => segA.start - segB.start);
  let unionEnd = -Infinity;
  for (const segment of overlapSegments) {
    if (segment.end > unionEnd) {
      overlapDuration += segment.end - Math.max(segment.start, unionEnd);
      unionEnd = segment.end;
    }
  }

  const overlapRatio =
    totalSpeechDuration > 0
      ? Math.min(1, Math.max(0, Math.round((overlapDuration / totalSpeechDuration) * 10000) / 10000))
      : 0;

  return {
    speakerCount,
    turnEntropy: Math.round(turnEntropy * 10000) / 10000,
    overlapRatio,
  };
}

/**
 * Safely redacts raw media URL for Sentry logging to prevent PII/signed token leakage,
 * preserving only the hostname or placeholder.
 */
export function redactMediaUrl(rawUrl: string | undefined): string {
  if (!rawUrl) return 'unknown';
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname;
  } catch {
    // Never log the parse error: `URL` errors carry the full raw input
    // (including signed query tokens) in their message/input fields.
    return 'redacted-invalid-url';
  }
}

/**
 * Strips URL(s) (including their query strings, which may carry signed
 * tokens) from provider-supplied error text before it is captured to Sentry
 * or rethrown. Replaces each URL with `[redacted-url]`.
 */
export function redactUrlsInText(text: string): string {
  // Matches http(s) URLs up to the first whitespace/quote/boundary character.
  return text.replace(/https?:\/\/[^\s'"<>()\\]+/g, '[redacted-url]');
}
