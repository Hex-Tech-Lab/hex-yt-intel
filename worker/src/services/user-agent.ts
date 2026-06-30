/**
 * User-Agent Rotation
 *
 * Rotates user agents to bypass YouTube API restrictions
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
] as const;

export function getRandomUserAgent(): string {
  if (USER_AGENTS.length === 0) {
    throw new Error('USER_AGENTS list is empty');
  }
  const randomIndex = Math.floor(Math.random() * USER_AGENTS.length);
  const selected = USER_AGENTS[randomIndex];
  if (!selected) {
    throw new Error(`Failed to select user agent at index ${randomIndex}`);
  }
  return selected;
}
