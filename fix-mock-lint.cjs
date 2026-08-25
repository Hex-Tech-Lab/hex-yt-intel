const fs = require('fs');
let file = fs.readFileSync('web/lib/__tests__/adr028-mock-purge-lifecycle.test.ts', 'utf8');

// 1. Fix imports
file = file.replace(/import \{ describe, it, expect, vi \} from 'vitest';[\s\S]*?import \{ KnowledgeHistoryService \} from '@\/lib\/services\/KnowledgeHistoryService';/,
`import { describe, it, expect, vi } from 'vitest';

import { KnowledgeHistoryService } from '@/lib/services/KnowledgeHistoryService';
import { ExtractHighlightsUseCase } from '@/lib/usecases/ExtractHighlightsUseCase';
import { ProcessChatMessageUseCase } from '@/lib/usecases/ProcessChatMessageUseCase';

import type { ChatPersistencePort, CryptographicTokenPort, ModelResolutionPort } from '@/lib/ports/ChatPorts';
import type { TemporalKnowledgePort } from '@/lib/ports/TemporalKnowledgePort';
import type { HighlightsPersistencePort } from '@/lib/usecases/ExtractHighlightsUseCase';`);

// 2. Remove redundant async from vi.fn().mockImplementation(async ...) that don't need it
file = file.replace(/mockImplementation\(async\s*\(\w*\)\s*=>\s*\{?\s*return\s*true;\s*\}?\)/g, 'mockImplementation((_) => Promise.resolve(true))');
file = file.replace(/mockImplementation\(async\s*\(\)\s*=>\s*\{?\s*return\s*savedAnchors;\s*\}?\)/g, 'mockImplementation(() => Promise.resolve(savedAnchors))');
file = file.replace(/mockImplementation\(async\s*\(params\)\s*=>\s*\{?\s*savedHighlights = params\.highlights;\s*return\s*true;\s*\}?\)/g, "mockImplementation((params) => {\n        savedHighlights = params.highlights;\n        return Promise.resolve(true);\n      })");
file = file.replace(/mockImplementation\(async\s*\(params\)\s*=>\s*\{?\s*savedAnchors\.push\(\.\.\.params\.anchors\);\s*return\s*true;\s*\}?\)/g, "mockImplementation((params) => {\n        savedAnchors.push(...params.anchors);\n        return Promise.resolve(true);\n      })");
file = file.replace(/mockImplementation\(async\s*\(\)\s*=>\s*\(\{\s*transcript:\s*rawTranscript,\s*highlights:\s*savedHighlights\s*\}\)\)/g, 'mockImplementation(() => Promise.resolve({ transcript: rawTranscript, highlights: savedHighlights }))');
file = file.replace(/mockImplementation\(async\s*\(params\)\s*=>\s*\(\{\s*id:\s*'msg-1',\s*\.\.\.params\s*\}\)\)/g, "mockImplementation((params) => Promise.resolve({ id: 'msg-1', ...params }))");

// 3. Rename single-letter variable `a`
file = file.replace(/\(a\)/g, '(anchor)');
file = file.replace(/a\.windowStart/g, 'anchor.windowStart');
file = file.replace(/a\.simhash64/g, 'anchor.simhash64');

fs.writeFileSync('web/lib/__tests__/adr028-mock-purge-lifecycle.test.ts', file);
