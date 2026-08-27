const fs = require('fs');

function replaceSentry(path, searchString, boundaryName, objName) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(searchString,
    `Sentry.captureMessage(\`Validation dropped payload at \${'${boundaryName}'}\`, {
          level: "warning",
          extra: {
            boundary: '${boundaryName}',
            issueCount: ${objName}.error.issues.length,
            issuePaths: ${objName}.error.issues.map((i: any) => \`\${i.path.join(".")}: \${i.code}\`),
          },
        });`
  );
  fs.writeFileSync(path, content);
}

const paddlePath = 'web/lib/adapters/PaddleBillingAdapter.ts';
replaceSentry(paddlePath, 
  "Sentry.captureMessage('PaddleBillingAdapter schema validation dropped payload', { level: 'warning', extra: { event_type: rawPayload?.event_type, errorCount: parsed.error.issues.length, issues: parsed.error.issues.map((i: any) => ({ path: i.path.join('.'), code: i.code })) } });",
  'PaddleBillingAdapter', 'parsed'
);
replaceSentry(paddlePath, 
  "Sentry.captureMessage('PaddleBillingAdapter schema validation dropped payload', { level: 'warning', extra: { event_type: rawPayload?.event_type, errorCount: parsed.error.issues.length, issues: parsed.error.issues.map((i: any) => ({ path: i.path.join('.'), code: i.code })) } });",
  'PaddleBillingAdapter', 'parsed'
);

const relationsPath = 'web/lib/intelligence/relations-engine.ts';
replaceSentry(relationsPath,
  "Sentry.captureMessage(\"relations-engine: schema validation dropped entity\", {\n          level: \"warning\",\n          extra: { errorCount: result.error.issues.length, issues: result.error.issues.map((i: any) => ({ path: i.path.join('.'), code: i.code })) }\n        });",
  'relations-engine', 'result'
);

const stitchPath = 'web/lib/services/stitch-analysis-chunks.ts';
replaceSentry(stitchPath,
  "Sentry.captureMessage('stitch-analysis-chunks: schema validation dropped node', { level: 'warning', extra: { errorCount: res.error.issues.length, issues: res.error.issues.map((i: any) => ({ path: i.path.join('.'), code: i.code })) } });",
  'stitch-analysis-chunks (node)', 'res'
);
replaceSentry(stitchPath,
  "Sentry.captureMessage('stitch-analysis-chunks: schema validation dropped edge', { level: 'warning', extra: { errorCount: edgeRes.error.issues.length, issues: edgeRes.error.issues.map((i: any) => ({ path: i.path.join('.'), code: i.code })) } });",
  'stitch-analysis-chunks (edge)', 'edgeRes'
);

