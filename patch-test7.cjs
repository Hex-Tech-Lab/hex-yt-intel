const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('useSearchParams: () => new URLSearchParams(),', 
`useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",`);

fs.writeFileSync(path, content);
