import type {
  DiarizationMetrics,
  WordDiarization,
} from '../ports/DiarizationProviderPort';

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

  for (const wordItem of words) {
    const duration = Math.max(0, wordItem.end - wordItem.start);
    if (duration > 0) {
      speakerDurations.set(wordItem.speaker, (speakerDurations.get(wordItem.speaker) || 0) + duration);
      totalSpeechDuration += duration;
    }
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

  // 2. Calculate overlapRatio (cross-talk / simultaneous speech between different speakers)
  let overlapDuration = 0;
  const sortedWords = [...words]
    .filter((wordItem) => wordItem.end > wordItem.start)
    .sort((prevWord, nextWord) => prevWord.start - nextWord.start);

  for (let outerIndex = 0; outerIndex < sortedWords.length; outerIndex++) {
    const currentWord = sortedWords[outerIndex]!;
    for (let innerIndex = outerIndex + 1; innerIndex < sortedWords.length; innerIndex++) {
      const nextWord = sortedWords[innerIndex]!;
      if (nextWord.start >= currentWord.end) {
        break;
      }

      if (nextWord.speaker !== currentWord.speaker) {
        const overlapStart = Math.max(currentWord.start, nextWord.start);
        const overlapEnd = Math.min(currentWord.end, nextWord.end);
        const overlap = overlapEnd - overlapStart;
        if (overlap > 0) {
          overlapDuration += overlap;
        }
      }
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
    return 'redacted-invalid-url';
  }
}
