const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('describe("DashboardContainer Fallback Logic"', 
`vi.mock("@/components/templates/console/DashboardLayout", () => ({
  DashboardLayout: ({ children }: any) => <div data-testid="dashboard-layout">{children}</div>,
}));

describe("DashboardContainer Fallback Logic"`);

fs.writeFileSync(path, content);
