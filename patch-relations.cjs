const fs = require('fs');
const path = 'web/lib/intelligence/relations-engine.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(`kind: z.enum(['tangent', 'contrarian']),`, 
`kind: z.preprocess((val) => typeof val === "string" ? val.trim().toLowerCase() : val, z.enum(['tangent', 'contrarian'])),`);

fs.writeFileSync(path, content);
