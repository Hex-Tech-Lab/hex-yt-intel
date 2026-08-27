const fs = require('fs');
const path = 'web/lib/intelligence/relations-engine.ts';
let content = fs.readFileSync(path, 'utf8');

const replacement = `      const result = LLMResponseSchema.safeParse(parsed);
      if (!result.success) {
        console.warn(\`[relations/engine] Schema validation dropped entity\`, result.error.issues);
        // Only import Sentry if it's not imported already, but let's just use console for now, wait, we need Sentry.
      }
      if (result.success) {`;

content = content.replace(`      const result = LLMResponseSchema.safeParse(parsed);\n      if (result.success) {`, replacement);

if (!content.includes("import * as Sentry")) {
    content = `import * as Sentry from '@sentry/nextjs';\n` + content;
}

content = content.replace(`console.warn(\`[relations/engine] Schema validation dropped entity\`, result.error.issues);`, 
`console.warn(\`[relations/engine] Schema validation dropped entity\`, result.error.issues);
        Sentry.captureMessage("relations-engine: schema validation dropped entity", {
          level: "warning",
          extra: { issues: result.error.issues, parsed }
        });`);

fs.writeFileSync(path, content);
