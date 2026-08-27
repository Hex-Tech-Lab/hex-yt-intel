const fs = require('fs');
const path = 'worker/src/services/PersistService.ts';
let content = fs.readFileSync(path, 'utf8');

const old = `console.warn('[persist] Schema validation dropped dimension', parsed.error.issues);
      // Sentry is used elsewhere in this file, we can assume it's imported`;

const newCode = `console.warn('[persist] Schema validation dropped dimension', parsed.error.issues);
      Sentry.captureMessage('PersistService: Schema validation dropped dimension', { level: 'warning', extra: { issues: parsed.error.issues } });`;

content = content.replace(old, newCode);
fs.writeFileSync(path, content);
