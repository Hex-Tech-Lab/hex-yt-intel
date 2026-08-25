const fs = require('fs');
let file = fs.readFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', 'utf8');

if (!file.includes('import { computeSimHash64')) {
  file = file.replace(
    /import \{ getChatGroundingInstructions \} from '@\/lib\/utils\/prompt-templates';/,
    "import { getChatGroundingInstructions } from '@/lib/utils/prompt-templates';\nimport { computeSimHash64 } from '@/lib/utils/simhash';"
  );
  fs.writeFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', file);
}

let testFile = fs.readFileSync('web/lib/__tests__/process-chat-temporal-grounding.test.ts', 'utf8');
testFile = testFile.replace(/appendInteraction: vi\.fn\(\),/, "appendInteraction: vi.fn(),\n      loadUserKnowledgeContext: vi.fn().mockResolvedValue(''),");
fs.writeFileSync('web/lib/__tests__/process-chat-temporal-grounding.test.ts', testFile);
