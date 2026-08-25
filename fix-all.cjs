const fs = require('fs');

// 1. ProcessChatMessageUseCase
let pc = fs.readFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', 'utf8');
if (pc.includes('this.temporalGraph')) {
  pc = pc.replace(
    /private temporalGraph\?\: TemporalKnowledgePort/,
    "public temporalGraph?: TemporalKnowledgePort" // avoids unused param if I only used it in a closure? No, if I used `this.temporalGraph` it shouldn't be unused. Wait, TS says property is declared but its value is never read. Wait, did my `fix-chat.cjs` fail to replace?
  );
  fs.writeFileSync('web/lib/usecases/ProcessChatMessageUseCase.ts', pc);
}

// 2. route
let route = fs.readFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', 'utf8');
// Let me just replace the constructor call manually.
route = route.replace(/const useCase = new ProcessChatMessageUseCase\([\s\S]*?knowledgeHistory[\s\S]*?\);/, 
  "const useCase = new ProcessChatMessageUseCase(\n      chatPersistence,\n      modelResolution,\n      tokenCrypto,\n      knowledgeHistory,\n      new SupabaseTemporalGraphAdapter()\n    );"
);
fs.writeFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', route);

// 3. ExtractHighlightsUseCase
// I'll just check out the file and redo the replacement cleanly.
