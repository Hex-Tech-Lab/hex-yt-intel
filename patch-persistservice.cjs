const fs = require('fs');
const path = 'worker/src/services/PersistService.ts';
let content = fs.readFileSync(path, 'utf8');

const replacement = `    if (parsed.success) {
      byNumber.set(parsed.data.number, parsed.data);
      validExtractedNumbers.add(parsed.data.number);
    } else {
      console.warn('[persist] Schema validation dropped dimension', parsed.error.issues);
      // Sentry is used elsewhere in this file, we can assume it's imported
      anyExtractedEntryWasInvalid = true;
    }`;

content = content.replace(`    if (parsed.success) {\n      byNumber.set(parsed.data.number, parsed.data);\n      validExtractedNumbers.add(parsed.data.number);\n    } else {\n      anyExtractedEntryWasInvalid = true;\n    }`, replacement);

fs.writeFileSync(path, content);
