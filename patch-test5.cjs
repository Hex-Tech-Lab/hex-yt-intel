const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace('vi.mock("@/lib/hooks/useEntitlements"', 
`vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/hooks/useEntitlements"`);

fs.writeFileSync(path, content);
