const fs = require('fs');
let route = fs.readFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', 'utf8');

if (!route.includes('SupabaseTemporalGraphAdapter')) {
  route = "import { SupabaseTemporalGraphAdapter } from '@/lib/adapters/SupabaseTemporalGraphAdapter';\n" + route;
  route = route.replace(
    /const useCase = new ProcessChatMessageUseCase\(\n      chatPersistence,\n      modelResolution,\n      tokenCrypto,\n      knowledgeHistory\n    \);/,
    "const useCase = new ProcessChatMessageUseCase(\n      chatPersistence,\n      modelResolution,\n      tokenCrypto,\n      knowledgeHistory,\n      new SupabaseTemporalGraphAdapter()\n    );"
  );
  fs.writeFileSync('web/app/api/chat/conversations/[id]/messages/route.ts', route);
}
console.log('Chat route updated');
