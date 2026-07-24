/**
 * Loader for disaster-fallback prompt text stored as base64 in a separate
 * file (web/lib/prompts/fallbacks/*.ts), not as a plaintext string literal
 * inline in the module that uses it.
 *
 * This is obfuscation, not encryption -- there is no key, so anyone with
 * repo access can decode it trivially. It exists only to stop a casual
 * `grep`/repo-browse from surfacing full prompt IP in plaintext, matching
 * the "prompt IP stays server-side" reasoning already documented on
 * PromptBuilderPort. Real confidentiality (if ever needed) would mean NOT
 * shipping the fallback in the repo at all -- which trades away the whole
 * point of a fallback (working when the DB/Vault registry is unreachable).
 *
 * Plain ES module import (not a runtime fs.readFileSync) deliberately --
 * imports are always correctly included by Next.js/Vercel's bundler; a
 * runtime file read of a path built from a variable is a classic
 * file-tracing gotcha that can silently drop the file from a serverless
 * deployment.
 */
export function decodeFallback(base64Content: string): string {
  return Buffer.from(base64Content, 'base64').toString('utf-8');
}
