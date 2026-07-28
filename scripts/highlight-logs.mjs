// Usage: paste or pipe Vercel JSONL log export through node scripts/highlight-logs.mjs (e.g. cat export.jsonl | node scripts/highlight-logs.mjs)
import readline from 'readline';

const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RESET = '\x1b[0m';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    console.log('');
    return;
  }

  try {
    const data = JSON.parse(trimmed);
    const level = typeof data.level === 'string' ? data.level.toLowerCase() : '';

    if (level === 'warn' || level === 'warning') {
      console.log(`${ANSI_YELLOW}${line}${ANSI_RESET}`);
    } else if (level === 'error' || level === 'fatal') {
      console.log(`${ANSI_RED}${line}${ANSI_RESET}`);
    } else {
      console.log(line);
    }
  } catch {
    console.log(line);
  }
});
