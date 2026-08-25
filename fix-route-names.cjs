const fs = require('fs');

// route.ts
let route = fs.readFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', 'utf8');
route = route.replace(
  /const useCase = new ProcessChatMessageUseCase\(\n      persistenceAdapter,\n      modelAdapter,\n      tokenAdapter,\n      knowledgeService\n    \);/,
  "const useCase = new ProcessChatMessageUseCase(\n      persistenceAdapter,\n      modelAdapter,\n      tokenAdapter,\n      knowledgeService,\n      new SupabaseTemporalGraphAdapter()\n    );"
);
fs.writeFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', route);

// ProcessChatMessageUseCase.ts
let pc = fs.readFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', 'utf8');
pc = pc.replace(
  /private temporalGraph\?\: TemporalKnowledgePort/,
  "public temporalGraph?: TemporalKnowledgePort"
);
fs.writeFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', pc);
