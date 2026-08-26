const fs = require('fs');
const path = 'web/lib/utils/node-weight-normalization.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  '  const wNorm = Math.log(1 + f) * normalizedS;\n  const clamped = Math.max(0.1, Math.min(10.0, wNorm)); // allow up to 10',
  '  const wNorm = Math.log2(1 + f) * normalizedS;\n  const clamped = Math.max(0.1, Math.min(1.0, wNorm));'
);

fs.writeFileSync(path, content);
