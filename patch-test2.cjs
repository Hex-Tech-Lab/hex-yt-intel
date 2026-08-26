const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('useTotalDimensions: () => 3,', 
`useTotalDimensions: () => 3,
  useSynthesisConfig: () => ({ dimensionConfigs: [] }),`);

fs.writeFileSync(path, content);
