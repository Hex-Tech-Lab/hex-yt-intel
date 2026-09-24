const fs = require('fs');
let code = fs.readFileSync('scripts/research/run-pricing-research.ts', 'utf8');

code = code.replace(/\.slice\(0, 8\)/g, '.filter((_, i) => i < 8)');

const functions = ['serpapiSearch', 'decodoSearch', 'exaSearch', 'braveSearch', 'perplexitySearch'];

for (const fn of functions) {
  const regex = new RegExp(`async function ${fn}\\(query: string\\): Promise<Result\\[\\]> \\{\\n([\\s\\S]*?)\\n\\}`);
  code = code.replace(regex, (match, body) => {
    return `async function ${fn}(query: string): Promise<Result[]> {\n  try {\n${body.split('\n').map(line => '  ' + line).join('\n')}\n  } finally {\n    // cleanup\n  }\n}`;
  });
}

fs.writeFileSync('scripts/research/run-pricing-research.ts', code);
