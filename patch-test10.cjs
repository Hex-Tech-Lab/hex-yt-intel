const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('useSynthesisNucleus: () => ({ nodes: [{ id: "n1", label: "Nucleus", weight: 0.9 }], edges: [] })', 
`useSynthesisNucleus: (selector: any) => selector({ analysis: { streaming: { dimensionsReceived: 0 } }, knowledgeGraph: { nodes: [{ id: "n1", label: "Nucleus", weight: 0.9 }], edges: [] } })`);

fs.writeFileSync(path, content);
