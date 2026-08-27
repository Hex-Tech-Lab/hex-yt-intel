const fs = require('fs');

function replaceSentry(path, boundaryName, objName) {
  let content = fs.readFileSync(path, 'utf8');
  content = content.replace(
    /Sentry\.captureMessage\([^,]+, \{ level: 'warning', extra: \{ [^}]+\} \}\);/g,
    `Sentry.captureMessage(\`Validation dropped payload at \${'${boundaryName}'}\`, {
        level: 'warning',
        extra: {
          boundary: '${boundaryName}',
          issueCount: ${objName}.error.issues.length,
          issuePaths: ${objName}.error.issues.map((i: any) => \`\${i.path.join(".")}: \${i.code}\`),
        },
      });`
  );
  fs.writeFileSync(path, content);
}

replaceSentry('web/lib/adapters/PaddleBillingAdapter.ts', 'PaddleBillingAdapter', 'parsed');
replaceSentry('web/lib/intelligence/relations-engine.ts', 'relations-engine', 'result');
replaceSentry('web/lib/services/stitch-analysis-chunks.ts', 'stitch-analysis-chunks (node)', 'res');

// We have edge validation too in stitch-analysis-chunks
let stitchContent = fs.readFileSync('web/lib/services/stitch-analysis-chunks.ts', 'utf8');
stitchContent = stitchContent.replace(
  /Sentry\.captureMessage\('stitch-analysis-chunks: schema validation dropped edge', \{ level: 'warning', extra: \{ [^}]+\} \}\);/g,
  `Sentry.captureMessage(\`Validation dropped payload at stitch-analysis-chunks (edge)\`, {
      level: 'warning',
      extra: {
        boundary: 'stitch-analysis-chunks (edge)',
        issueCount: edgeRes.error.issues.length,
        issuePaths: edgeRes.error.issues.map((i: any) => \`\${i.path.join(".")}: \${i.code}\`),
      },
    });`
);
fs.writeFileSync('web/lib/services/stitch-analysis-chunks.ts', stitchContent);

