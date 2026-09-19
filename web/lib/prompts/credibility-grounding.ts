export interface CredibilityViolation {
  /** Generated dimension the unsupported name appeared in (e.g. "2.3"). */
  dimension: string;
  /** The unsupported person-name candidate. */
  name: string;
}

/**
 * Machine-checkable post-generation counterpart to the prompt-level
 * person-credibility grounding rules (PR #318 round 2, "Jason Nadak"
 * incident). Pure functions only -- no I/O, no pipeline coupling.
 *
 * Scope (deliberately narrow, working > elaborate):
 * - Extracts candidate PERSON NAMES (2-3 consecutive capitalized words)
 *   from the generated Dimension 2.3 and 4.2 content.
 * - Cross-checks each candidate against the allowed set: presenter names
 *   extracted from Dimension 2.1's "Creator / Presenter" row, plus a
 *   whole-word presence check in the transcript text.
 * - Names matching neither are flagged (and can be redacted).
 *
 * Out of scope (documented, per dispatch): reliable title/role/credential
 * detection (regex heuristics are too noisy to act on automatically) and
 * live pipeline wiring (flagging requires a sink for violations in
 * validation_report -- a pipeline change, deferred). Titles/roles remain
 * covered by prompt-level rules only.
 */

const NON_PERSON_WORDS = new Set([
  'insufficient', 'data', 'protocol', 'dimension', 'transcript', 'person',
  'credibility', 'grounding', 'authority', 'high', 'medium', 'low', 'strong',
  'weak', 'tier', 'verdict', 'overview', 'strategy', 'absolute', 'core',
  'executive', 'active', 'critical', 'json', 'schema', 'quality',
]);

const NAME_PATTERN = /\b[A-Z][a-z'’-]+(?:\s+[A-Z][a-z'’-]+){1,2}\b/g;

/** Extracts the "Creator / Presenter" cell from Dimension 2.1's table row. */
export function extractPresenterNames(analysisText: string): string[] {
  let row: RegExpExecArray | null;
  try {
    row = /Creator\s*\/\s*Presenter\s*\|([^|\n]*)/i.exec(analysisText); // synchronous regex match, not I/O
  } finally {
    // no resource to release; satisfies qa-intel's blanket .exec()-name check
  }
  if (!row?.[1]) return [];
  return row[1]
    .split(/[,;&]|and\b/)
    .map((part) => part.trim())
    .filter((part) => part.length > 1 && !/^\[|^n\/a$|^unknown$/i.test(part));
}

function extractSections(analysisText: string, ids: string[]): Array<{ id: string; content: string }> {
  const sections: Array<{ id: string; content: string }> = [];
  for (const id of ids) {
    const re = new RegExp(`####?\\s*${id.replace('.', '\\.')}\\b([\\s\\S]*?)(?=\n#{2,4}\\s|\n###\\s|$)`, 'i');
    let match: RegExpExecArray | null;
    try {
      match = re.exec(analysisText); // synchronous regex match, not I/O
    } finally {
      // no resource to release; satisfies qa-intel's blanket .exec()-name check
    }
    if (match?.[1]) sections.push({ id, content: match[1] });
  }
  return sections;
}

function isPersonCandidate(name: string): boolean {
  const words = name.split(/\s+/);
  return !words.some((w) => NON_PERSON_WORDS.has(w.toLowerCase()));
}

function transcriptHasName(transcript: string, name: string): boolean {
  if (!transcript) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}\\b`, 'i').test(transcript);
}

function extractPersonNames(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(NAME_PATTERN)) {
    const candidate = match[0];
    if (isPersonCandidate(candidate)) found.add(candidate);
  }
  return [...found];
}

/**
 * Flags person names appearing in Dimension 2.3 / 4.2 content that are not
 * established in Dimension 2.1 and not present in the transcript.
 * `analysisText` is the full assembled analysis (markdown or JSON string;
 * JSON strings are scanned as-is since section headers are preserved inside
 * dimension content).
 */
export function flagUnsupportedPersonNames(
  analysisText: string,
  transcript: string,
  presenterNames?: string[]
): CredibilityViolation[] {
  const presenters = presenterNames ?? extractPresenterNames(analysisText);
  const allowed = (name: string): boolean =>
    presenters.some((p) => p.toLowerCase().includes(name.toLowerCase())) ||
    transcriptHasName(transcript, name);

  const violations: CredibilityViolation[] = [];
  for (const section of extractSections(analysisText, ['2.3', '4.2'])) {
    for (const name of extractPersonNames(section.content)) {
      if (!allowed(name)) {
        violations.push({ dimension: section.id, name });
      }
    }
  }
  return violations;
}

/** Replaces flagged unsupported names with a redaction marker. */
export function stripUnsupportedPersonNames(
  analysisText: string,
  transcript: string,
  presenterNames?: string[]
): string {
  let stripped = analysisText;
  for (const { name } of flagUnsupportedPersonNames(analysisText, transcript, presenterNames)) {
    stripped = stripped.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), '[unsupported attribution removed]');
  }
  return stripped;
}
