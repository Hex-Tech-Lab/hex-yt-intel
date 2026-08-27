const fs = require('fs');
const path = 'web/lib/services/stitch-analysis-chunks.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `(node) => { const res = KGNodeSchema.safeParse(node); if (!res.success) console.log(node, res.error); return res.success; },`,
  `(node) => { const res = KGNodeSchema.safeParse(node); if (!res.success) { console.warn('[stitch-analysis-chunks] Schema validation dropped entity', res.error.issues); Sentry.captureMessage('stitch-analysis-chunks: schema validation dropped node', { level: 'warning', extra: { issues: res.error.issues, node } }); } return res.success; },`
);

content = content.replace(
  `if (!KGEdgeSchema.safeParse(edge).success) return false;`,
  `const edgeRes = KGEdgeSchema.safeParse(edge); if (!edgeRes.success) { console.warn('[stitch-analysis-chunks] Schema validation dropped edge', edgeRes.error.issues); Sentry.captureMessage('stitch-analysis-chunks: schema validation dropped edge', { level: 'warning', extra: { issues: edgeRes.error.issues, edge } }); return false; }`
);

if (!content.includes("import * as Sentry")) {
  content = `import * as Sentry from '@sentry/nextjs';\n` + content;
}

fs.writeFileSync(path, content);
