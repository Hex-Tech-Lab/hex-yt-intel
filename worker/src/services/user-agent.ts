/**
 * User-Agent Rotation
 *
 * Rotates user agents via cryptographically-secure randomization
 * to bypass YouTube API restrictions and rotate request fingerprints.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
] as const;

/**
 * Select a random user agent from the pool using cryptographically-secure randomization.
 * @returns A randomly selected user agent string.
 * @throws If the user agent pool is empty or selection fails.
 */
export function getRandomUserAgent(): string {
  const max = USER_AGENTS.length;
  if (max === 0) {
    throw new Error('USER_AGENTS list is empty');
  }
  const bytesNeeded = Math.ceil(Math.log2(max) / 8);
  const limit = Math.pow(2, bytesNeeded * 8);
  const range = Math.floor(limit / max) * max;

  let randomValue: number;
  do {
    randomValue = crypto.getRandomValues(new Uint8Array(bytesNeeded)).reduce((acc, byte) => acc * 256 + byte, 0);
  } while (randomValue >= range);

  const randomIndex = randomValue % max;
  const selected = USER_AGENTS[randomIndex];
  if (!selected) {
    throw new Error(`Failed to select user agent at index ${randomIndex}`);
  }
  return selected;
}
