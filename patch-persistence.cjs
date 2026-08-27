const fs = require('fs');
const path = 'web/lib/adapters/SupabasePersistenceAdapter.ts';
let content = fs.readFileSync(path, 'utf8');

// There are probably multiple instances of `|| 'concept'`
content = content.replace(/\|\| 'concept'/g, "|| 'Object'");
// But wait! Is 'Object' used as a fallback for entityType? Yes, ADR says POLE+O 'Object' is the fallback.

fs.writeFileSync(path, content);
