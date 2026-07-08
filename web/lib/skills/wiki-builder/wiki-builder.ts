/**
 * Wiki Builder Skill (WAVE 4.2)
 * Monthly QStash-triggered skill that aggregates captured questions into theme-based wikis.
 *
 * Flow:
 * 1. Read questions from Supabase Storage (/raw/{userId}/questions/*.md)
 * 2. Extract keywords from each question (regex + stop-word filtering)
 * 3. Cluster questions into themes (FAQ, troubleshooting, how-to, etc.)
 * 4. Generate markdown wiki with FAQ structure + learning themes
 * 5. Upsert into public.user_knowledge_wiki (userId, topic, wiki_markdown)
 *
 * Idempotent: same questions → same wiki, safe to re-run monthly
 */

import { getSupabaseServiceClient } from '@/lib/supabase';
import * as Sentry from '@sentry/nextjs';

// Common stop words to filter out during keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'he', 'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'to',
  'was', 'will', 'with', 'you', 'your', 'me', 'my', 'we', 'this', 'that',
  'these', 'those', 'what', 'when', 'where', 'why', 'how', 'if', 'do', 'does',
  'did', 'can', 'could', 'would', 'should', 'have', 'has', 'had', 'am', 'been',
]);

// Theme keywords for clustering
const THEME_PATTERNS = {
  'FAQ': /^(how do|what|why|when|which|where|how to|help|question|issue|\?)/i,
  'Troubleshooting': /^(error|problem|issue|bug|fail|crash|broken|not work|doesn't|won't|can't|cannot|why is my|doesn't work|not working)/i,
  'How-to': /^(how do|how to|how can|steps|guide|tutorial|walkthrough|what's the|what is)/i,
  'Best Practices': /^(best|practice|should|recommended|tip|trick|pattern|approach|strategy|method)/i,
  'Conceptual': /^(explain|understand|concept|definition|meaning|clarify|definition of)/i,
};

export interface QuestionData {
  questionId: string;
  question: string;
  timestamp: string;
  conversationId?: string;
  analysisId?: string;
}

export interface ThemeCluster {
  theme: string;
  questions: QuestionData[];
  keywords: Map<string, number>;
}

export interface WikiBuildResult {
  success: boolean;
  userId: string;
  wikisTopic: string;
  questionsProcessed: number;
  themesDiscovered: number;
  wikiId: string;
  createdAt: string;
  error?: string;
}

/**
 * Main entry point: build monthly wiki for a single user.
 * Returns a result object with metadata about the build.
 */
export async function buildMonthlyWiki(
  userId: string,
  previousMonth: Date
): Promise<WikiBuildResult> {
  try {
    const supabase = getSupabaseServiceClient();

    // Step 1: Read questions from Supabase Storage
    const questions = await readQuestionsFromStorage(supabase, userId, previousMonth);

    if (!questions.length) {
      console.log(`[wiki-builder] No questions found for user ${userId} in previous month`);
      return {
        success: false,
        userId,
        wikisTopic: 'empty',
        questionsProcessed: 0,
        themesDiscovered: 0,
        wikiId: '',
        createdAt: new Date().toISOString(),
        error: 'No questions to aggregate',
      };
    }

    // Step 2: Extract keywords and cluster into themes
    const themes = clusterQuestionsByTheme(questions);

    // Step 3: Generate markdown wiki
    const monthName = previousMonth.toLocaleString('default', { month: 'long', year: 'numeric' });
    const wikiMarkdown = generateWikiMarkdown(themes, monthName);

    // Step 4: Upsert into Supabase with deterministic idempotency
    // IDEMPOTENCY GUARANTEE: Topic is derived deterministically from month/year
    //   - Example: "May 2026" → "may-2026-digest"
    //   - Same month always produces same topic string
    // DEDUP GUARANTEE: Upsert with onConflict 'user_id,topic' ensures:
    //   - Same (userId, topic) tuple → always overwrites, never duplicates
    //   - Same questions + same month → same wiki_markdown output
    // SAFETY: Re-running same month multiple times produces identical result (idempotent)
    const topic = `${monthName.replace(/\s+/g, '-').toLowerCase()}-digest`;
    const { data, error } = await supabase
      .from('user_knowledge_wiki')
      .upsert(
        {
          user_id: userId,
          topic,
          wiki_markdown: wikiMarkdown,
          question_count: questions.length,
          theme_count: themes.length,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,topic' }
      )
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to upsert wiki: ${error.message}`);
    }

    const wikiId = data?.id || '';

    console.log(`[wiki-builder] Wiki built for user ${userId}`, {
      topic,
      questionsProcessed: questions.length,
      themesDiscovered: themes.length,
      wikiId,
    });

    return {
      success: true,
      userId,
      wikisTopic: topic,
      questionsProcessed: questions.length,
      themesDiscovered: themes.length,
      wikiId,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Sentry.captureException(error, {
      tags: { service: 'wiki-builder' },
      extra: { userId },
    });
    console.error(`[wiki-builder] Failed to build wiki for user ${userId}:`, message);

    return {
      success: false,
      userId,
      wikisTopic: '',
      questionsProcessed: 0,
      themesDiscovered: 0,
      wikiId: '',
      createdAt: new Date().toISOString(),
      error: message,
    };
  }
}

/**
 * Read question files from Supabase Storage for the previous month.
 * Returns parsed question data from markdown files.
 *
 * MONTH BOUNDARY BEHAVIOR (EXPLICIT FOR DATA CORRECTNESS):
 * - Start boundary: First millisecond of first day (00:00:00.000)
 * - End boundary: Last millisecond of last day (23:59:59.999)
 * - Both boundaries are INCLUSIVE for file comparison
 * - Example: May 2026 includes files from May 1 00:00:00.000 through May 31 23:59:59.999
 * - Edge cases handled: leap years, month transitions
 * - Last day of month is fully included (no data loss at month boundaries)
 *
 * Edge Cases Handled:
 * 1. Missing/deleted storage directory (returns empty list, no error)
 * 2. Empty question files (skipped with warning)
 * 3. Malformed markdown (skipped with warning, partial content discarded)
 * 4. Missing metadata fields (uses defaults: empty questionId, current timestamp)
 */
async function readQuestionsFromStorage(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  userId: string,
  previousMonth: Date
): Promise<QuestionData[]> {
  try {
    // Calculate month boundaries explicitly with full precision
    // First day starts at 00:00:00.000, last day ends at 23:59:59.999
    const monthStart = new Date(previousMonth.getFullYear(), previousMonth.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0, 23, 59, 59, 999);

    // List all files in /raw/{userId}/questions/
    const { data: files, error: listError } = await supabase.storage
      .from('analyses')
      .list(`raw/${userId}/questions`, {
        limit: 1000,
        sortBy: { column: 'created_at', order: 'desc' },
      });

    if (listError && !listError.message.includes('not found')) {
      throw new Error(`Failed to list storage files: ${listError.message}`);
    }

    if (!files || files.length === 0) {
      return [];
    }

    const questions: QuestionData[] = [];

    // Filter files for the previous month and parse each
    for (const file of files) {
      if (!file.name.endsWith('.md')) continue;

      const fileCreatedAt = file.created_at ? new Date(file.created_at) : null;
      // Month boundary check: include entire last day of month (inclusive on both ends)
      if (!fileCreatedAt || fileCreatedAt < monthStart || fileCreatedAt > monthEnd) {
        continue;
      }

      try {
        // Download and parse the markdown file
        const { data, error: downloadError } = await supabase.storage
          .from('analyses')
          .download(`raw/${userId}/questions/${file.name}`);

        if (downloadError) {
          console.warn(`[wiki-builder] Failed to download file ${file.name}:`, downloadError);
          continue;
        }

        const content = await data?.text();
        if (!content || content.trim() === '') {
          console.warn(`[wiki-builder] Empty content in file ${file.name}`);
          continue;
        }

        const parsed = parseQuestionMarkdown(content, file.name);
        if (parsed) {
          questions.push(parsed);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[wiki-builder] Failed to parse question file ${file.name}:`, msg);
        continue;
      }
    }

    return questions;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[wiki-builder] Error reading questions from storage:`, message);
    return [];
  }
}

/**
 * Parse question markdown file with YAML front matter.
 * Format:
 * ---
 * questionId: uuid
 * conversationId: uuid
 * userId: uuid
 * analysisId: uuid or null
 * timestamp: ISO 8601
 * ---
 *
 * # User Question
 *
 * {question text}
 *
 * PARSING EDGE CASES HANDLED:
 * 1. Missing front matter delimiters (---) → returns null (invalid format)
 * 2. Missing question body → returns null (no content)
 * 3. Empty or whitespace-only question → returns null
 * 4. Missing metadata fields → uses defaults (questionId='', timestamp=now)
 * 5. analysisId is "null" string → treats as undefined (not the literal value "null")
 * 6. Quoted metadata values → supports "quoted" and 'quoted' format
 *
 * IDEMPOTENCY: Same input file always produces identical output (deterministic parsing)
 */
function parseQuestionMarkdown(content: string, filename: string): QuestionData | null {
  try {
    // Extract front matter (strict: requires both delimiters)
    const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontMatterMatch) {
      console.warn(`[wiki-builder] No front matter delimiters found in ${filename}`);
      return null;
    }

    const frontMatterText = frontMatterMatch[1]?.trim();
    const bodyText = frontMatterMatch[2];

    if (!frontMatterText) {
      console.warn(`[wiki-builder] Empty front matter in ${filename}`);
      return null;
    }

    if (bodyText === undefined) {
      console.warn(`[wiki-builder] No body content after front matter in ${filename}`);
      return null;
    }

    // Parse YAML-like front matter (simple key: value parsing)
    // Handles lines with and without quotes
    const metadata: Record<string, string> = {};
    for (const line of frontMatterText.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty lines and comments

      const match = trimmed.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const key = match[1];
        let value = match[2].trim();
        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        metadata[key] = value;
      }
    }

    // Extract question text (skip "# User Question" header if present)
    let question = bodyText.replace(/^#\s+User Question\s*\n/, '').trim();

    if (!question) {
      console.warn(`[wiki-builder] No question text found in ${filename}`);
      return null;
    }

    // Validate question has meaningful content (not just punctuation)
    if (question.replace(/[^\w\s]/g, '').trim().length === 0) {
      console.warn(`[wiki-builder] Question contains only punctuation in ${filename}`);
      return null;
    }

    return {
      questionId: metadata.questionId || '', // Default empty string (will be caught by dedup if needed)
      question,
      timestamp: metadata.timestamp || new Date().toISOString(),
      conversationId: metadata.conversationId,
      analysisId: metadata.analysisId && metadata.analysisId !== 'null' ? metadata.analysisId : undefined,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[wiki-builder] Error parsing markdown ${filename}:`, msg);
    return null;
  }
}

/**
 * Cluster questions by theme using keyword matching.
 * Returns themes sorted by question count (descending).
 *
 * CLUSTERING BEHAVIOR (FOR DATA INTEGRITY):
 * - A question can be assigned to multiple themes if it matches multiple patterns
 * - If no pattern matches, question is assigned to "General" theme as fallback
 * - Keywords are extracted and counted per theme independently
 * - Questions are never deduplicated (same question may appear in multiple themes)
 *
 * PERFORMANCE: Keywords extracted once per question (cached), not per theme
 *
 * IDEMPOTENCY: Same input questions always produce identical theme assignments and keyword counts
 */
export function clusterQuestionsByTheme(questions: QuestionData[]): ThemeCluster[] {
  const themeClusters = new Map<string, QuestionData[]>();
  const themeKeywords = new Map<string, Map<string, number>>();

  // Extract keywords once per question (optimization: avoid repeated extraction)
  const questionKeywords = new Map<string, string[]>();
  for (const question of questions) {
    questionKeywords.set(question.questionId || question.question, extractKeywords(question.question));
  }

  // Assign each question to themes based on pattern matching
  for (const question of questions) {
    let assigned = false;
    const keywords = questionKeywords.get(question.questionId || question.question) || [];

    for (const [theme, pattern] of Object.entries(THEME_PATTERNS)) {
      if (pattern.test(question.question)) {
        if (!themeClusters.has(theme)) {
          themeClusters.set(theme, []);
          themeKeywords.set(theme, new Map());
        }
        themeClusters.get(theme)?.push(question);

        // Count keywords for this theme
        const keywordMap = themeKeywords.get(theme) || new Map();
        for (const keyword of keywords) {
          keywordMap.set(keyword, (keywordMap.get(keyword) || 0) + 1);
        }
        themeKeywords.set(theme, keywordMap);

        assigned = true;
      }
    }

    // Fallback: if no theme matched, assign to generic "General"
    if (!assigned) {
      if (!themeClusters.has('General')) {
        themeClusters.set('General', []);
        themeKeywords.set('General', new Map());
      }
      themeClusters.get('General')?.push(question);

      // Count keywords for General theme
      const keywordMap = themeKeywords.get('General') || new Map();
      for (const keyword of keywords) {
        keywordMap.set(keyword, (keywordMap.get(keyword) || 0) + 1);
      }
      themeKeywords.set('General', keywordMap);
    }
  }

  // Convert to sorted array
  const clusters: ThemeCluster[] = Array.from(themeClusters.entries())
    .map(([theme, qs]) => ({
      theme,
      questions: qs,
      keywords: themeKeywords.get(theme) || new Map(),
    }))
    .sort((a, b) => b.questions.length - a.questions.length);

  return clusters;
}

/**
 * Extract keywords from a question string.
 * Simple implementation: split by whitespace, remove stop words, normalize case.
 */
function extractKeywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove punctuation
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));

  return Array.from(new Set(words)); // Deduplicate
}

/**
 * Generate markdown wiki from theme clusters.
 * Format:
 * # {Month Name} Knowledge Wiki
 *
 * ## {Theme Name}
 * ### FAQ
 * - Question 1
 * - Question 2
 *
 * ### Common Keywords
 * - keyword1, keyword2, ...
 */
export function generateWikiMarkdown(themes: ThemeCluster[], monthName: string): string {
  let markdown = `# ${monthName} Knowledge Wiki\n\n`;
  markdown += `*Auto-generated knowledge base from user questions*\n\n`;

  if (themes.length === 0) {
    markdown += '## No themes discovered\n';
    return markdown;
  }

  for (const theme of themes) {
    markdown += `## ${theme.theme}\n\n`;
    markdown += `**Questions in this theme:** ${theme.questions.length}\n\n`;

    markdown += '### FAQ\n';
    for (const q of theme.questions) {
      // Escape markdown special chars in question
      const escapedQuestion = q.question
        .replace(/[\\[\]()]/g, '\\$&')
        .substring(0, 200); // Truncate long questions

      markdown += `- ${escapedQuestion}${q.question.length > 200 ? '...' : ''}\n`;
    }
    markdown += '\n';

    // Top keywords for this theme
    const topKeywords = Array.from(theme.keywords.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([keyword]) => keyword);

    if (topKeywords.length > 0) {
      markdown += '### Common Keywords\n';
      markdown += topKeywords.join(', ');
      markdown += '\n\n';
    }
  }

  return markdown;
}

/**
 * Get all active users for monthly wiki generation.
 * Queries auth.users table for all non-deleted users.
 * Returns pagination cursor for large user bases.
 */
export async function getAllActiveUsers(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  limit: number = 100,
  offset: number = 0
): Promise<{ users: Array<{ id: string }>; totalCount: number }> {
  try {
    // Query auth.users table
    const { data, error, count } = await supabase
      .from('users') // This queries auth.users view (if available)
      .select('id', { count: 'exact' })
      .range(offset, offset + limit - 1);

    if (error) {
      console.warn('[wiki-builder] Error querying users:', error.message);
      // Fallback: return empty list
      return { users: [], totalCount: 0 };
    }

    return {
      users: data || [],
      totalCount: count || 0,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[wiki-builder] Failed to fetch users:', msg);
    return { users: [], totalCount: 0 };
  }
}
