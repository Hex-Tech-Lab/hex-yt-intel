/**
 * Deterministic transcript range extraction for chat.
 *
 * RCA (2026-07-23, live production test): asking chat for "minute 52" (or a
 * bare terse follow-up like "52") reliably returned only 2-3 lines near the
 * *start* of that minute and stopped, even after the grounding prompt was
 * given an explicit instruction to "scan the entire transcript and quote
 * every line in the range." The transcript DATA was confirmed complete (23
 * real segments for 51:00-53:00, including the line the user was looking
 * for) -- this is a pure LLM instruction-following gap on long verbatim
 * extraction, not a data or grounding-assembly bug. A soft prompt
 * instruction cannot force compliance; the fix moves correctness out of the
 * model's hands entirely: parse the user's message for a minute/timestamp
 * reference, extract the *exact* matching lines from the already-assembled
 * transcript text via regex, and inject them as a guaranteed-complete block
 * the model only needs to relay, not search for.
 */

export interface RequestedTranscriptRange {
  startSec: number;
  endSec: number;
  lines: string[];
}

const TIMESTAMP_LINE = /^\[(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\]\s*(.*)$/;

/** Parses a "[m:ss]" or "[h:mm:ss]" prefix into total seconds. Returns null if malformed. */
function parseLineTimestamp(line: string): { seconds: number; text: string } | null {
  const match = TIMESTAMP_LINE.exec(line);
  if (!match) return null;
  const [, a, b, c, text] = match;
  // [m:ss] -> a=minutes, b=seconds; [h:mm:ss] -> a=hours, b=minutes, c=seconds
  const seconds = c !== undefined
    ? Number(a) * 3600 + Number(b) * 60 + Number(c)
    : b !== undefined
      ? Number(a) * 60 + Number(b)
      : Number(a);
  return { seconds, text: text ?? '' };
}

/**
 * Detects a minute/timestamp-range reference in a chat message and returns
 * the [startSec, endSec) window to extract, or null if no such reference is
 * found. Deliberately conservative: only matches unambiguous range language
 * or a message that is ENTIRELY a bare number (a common terse follow-up to
 * "what happened at minute X?"), never a number embedded in an unrelated
 * request (e.g. "give me 5 ideas").
 */
export function detectRequestedRange(message: string): { startSec: number; endSec: number } | null {
  const trimmed = message.trim();

  // "51:00 to 52:00", "51:00-52:00", "51:00 – 52:30"
  const explicitRange = /(\d{1,2}):(\d{2})\s*(?:to|-|–|—)\s*(\d{1,2}):(\d{2})/i.exec(trimmed);
  if (explicitRange) {
    const [, m1, s1, m2, s2] = explicitRange;
    const startSec = Number(m1) * 60 + Number(s1);
    const endSec = Number(m2) * 60 + Number(s2);
    if (endSec > startSec) return { startSec, endSec };
  }

  // "minute 52", "min. 52", "min 52", "mins 52"
  const minuteWord = /\bmin(?:ute)?s?\.?\s*(\d{1,3})\b/i.exec(trimmed);
  if (minuteWord && minuteWord[1]) {
    const n = Number(minuteWord[1]);
    return { startSec: n * 60, endSec: (n + 1) * 60 };
  }

  // Arabic "دقيقة"/"الدقيقة" (minute), digit may appear before or after the
  // word (Arabic sentence order commonly puts it after, e.g. "الدقيقة 52").
  const arabicMinuteWord = /(\d{1,3})\s*(?:دقيقة|دقيقه|الدقيقة|الدقيقه)|(?:دقيقة|دقيقه|الدقيقة|الدقيقه)\s*(\d{1,3})/.exec(trimmed);
  if (arabicMinuteWord) {
    const n = Number(arabicMinuteWord[1] ?? arabicMinuteWord[2]);
    if (Number.isFinite(n)) return { startSec: n * 60, endSec: (n + 1) * 60 };
  }

  // A single "mm:ss" timestamp mentioned anywhere -- treat as "that minute".
  const singleTimestamp = /\b(\d{1,2}):(\d{2})\b/.exec(trimmed);
  if (singleTimestamp) {
    const [, m] = singleTimestamp;
    const n = Number(m);
    return { startSec: n * 60, endSec: (n + 1) * 60 };
  }

  // A message that is ENTIRELY a bare number (e.g. "52" as a terse follow-up
  // to a prior "what happened at minute X?" question) -- deliberately requires
  // the WHOLE trimmed message to be just digits so this never fires on a
  // number embedded in an unrelated request.
  const bareNumber = /^(\d{1,3})[.?!]?$/.exec(trimmed);
  if (bareNumber && bareNumber[1]) {
    const n = Number(bareNumber[1]);
    return { startSec: n * 60, endSec: (n + 1) * 60 };
  }

  return null;
}

/**
 * Extracts every transcript line whose timestamp falls within [startSec,
 * endSec) from an already-formatted "[m:ss] text\n..." transcript string.
 *
 * `leadInSeconds` (2026-07-25, live production report): a user asking for
 * "minute 42" means "what was being discussed around/at minute 42" -- but
 * transcript segments don't align to round numbers, so the sentence that's
 * actually relevant often starts a few seconds BEFORE the matched boundary
 * (e.g. the real answer starts at 41:55, not 42:00). Without a buffer, the
 * returned excerpt starts mid-thought, missing the lead-in context. This
 * shifts the inclusion window's start earlier by `leadInSeconds`, clamped to
 * 0 so it never underflows into negative territory. The caller-facing
 * `startSec`/`endSec` reflect the ORIGINAL requested range (unchanged) --
 * only the line-selection window is widened -- so anything keyed off the
 * detected range (e.g. UI labeling) still reads "minute 42", not "41:55".
 * Value is registry-driven (`chat.transcriptRange.leadInSeconds`), resolved
 * by the caller -- see ProcessChatMessageUseCase.ts.
 */
export function extractRequestedTranscriptRange(
  formattedTranscript: string,
  message: string,
  leadInSeconds = 0
): RequestedTranscriptRange | null {
  const range = detectRequestedRange(message);
  if (!range) return null;

  const bufferedStartSec = Math.max(0, range.startSec - Math.max(0, leadInSeconds));

  const lines: string[] = [];
  for (const rawLine of formattedTranscript.split('\n')) {
    const parsed = parseLineTimestamp(rawLine);
    if (!parsed) continue;
    if (parsed.seconds >= bufferedStartSec && parsed.seconds < range.endSec) {
      lines.push(rawLine);
    }
  }

  return { startSec: range.startSec, endSec: range.endSec, lines };
}
