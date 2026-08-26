const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('analysis: { id: "test", videoId: "v1" },', 
`analysis: { id: "test", videoId: "v1", streaming: { dimensionsReceived: 0 } },`);

fs.writeFileSync(path, content);
