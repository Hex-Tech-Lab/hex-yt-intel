const fs = require('fs');
const path = 'worker/src/services/ZodSchemas.ts';
let content = fs.readFileSync(path, 'utf8');

const helper = `export const CaseInsensitiveEnum = <T extends string>(values: readonly [T, ...T[]]) =>
  z.preprocess(
    (val) => (typeof val === "string" ? val.trim().toLowerCase() : val),
    z.enum(values)
  );\n\n`;

content = content.replace('export const KGNodeSchema', helper + 'export const KGNodeSchema');

content = content.replace(/z\.enum\(\[\n    'person', \n    'concept', \n    'framework', \n    'tool', \n    'organization', \n    'study', \n    'trend', \n    'metric'\n  \]\)/g, 
`CaseInsensitiveEnum(['person', 'concept', 'framework', 'tool', 'organization', 'study', 'trend', 'metric'])`);

content = content.replace(/z\.enum\(\['similar', 'related', 'tangent', 'contrarian'\]\)/g,
`CaseInsensitiveEnum(['similar', 'related', 'tangent', 'contrarian'])`);

fs.writeFileSync(path, content);
