const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/adr028-mock-purge-lifecycle.test.ts', 'utf8');

file = file.replace(/resolveAnchorByHammingDistance:\s*vi\.fn\(\)\.mockImplementation\(async\s*\(\)\s*=>\s*\{\s*return\s*savedAnchors\[0\];\s*\}\)/, '');
file = file.replace(/resolveAnchorByHammingDistance:\s*vi\.fn\(\)\.mockResolvedValue\(null\)/, '');
// there may be a trailing comma to clean up, but JS doesn't care in mock object

fs.writeFileSync('web/lib/__tests__/adr028-mock-purge-lifecycle.test.ts', file);
