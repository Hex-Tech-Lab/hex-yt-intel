/**
 * PromptConfigPort — Domain Port (Hexagonal-Lite)
 *
 * Resolves the live, versioned UCIS system-prompt template. Kept separate
 * from PromptBuilderPort: this only answers "what's the current template
 * text," the builder handles injecting metadata/persona/transcript around it.
 */

export interface PromptConfigPort {
  /** Returns the live DB-backed template text, or null if unavailable (caller uses its embedded fallback). */
  resolvePromptTemplate(version?: string): Promise<string | null>;
}
