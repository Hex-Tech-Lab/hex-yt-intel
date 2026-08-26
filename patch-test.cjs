const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('vi.mock("@/lib/hooks/useEffectiveViewMode", () => ({', 
`vi.mock("@/lib/config/synthesis-with-settings", () => ({
  useTotalDimensions: () => 3,
}));

vi.mock("@/lib/hooks/useEffectiveViewMode", () => ({`);

fs.writeFileSync(path, content);
