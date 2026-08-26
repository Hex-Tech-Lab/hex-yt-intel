const fs = require('fs');
const path = 'web/lib/types/synthesis-nucleus.ts';
let content = fs.readFileSync(path, 'utf8');

const oldEnum = `'person' | 'concept' | 'framework' | 'tool' |
              'organization' | 'study' | 'trend' | 'metric';`;

const newEnum = `'person' | 'concept' | 'framework' | 'tool' |
              'organization' | 'study' | 'trend' | 'metric' |
              'Person' | 'Organization' | 'Location' | 'Event' | 'Object';`;

content = content.replace(oldEnum, newEnum);
fs.writeFileSync(path, content);
