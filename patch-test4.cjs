const fs = require('fs');
const path = 'web/components/containers/__tests__/DashboardContainer.test.tsx';
let content = fs.readFileSync(path, 'utf8');

const mockProfile = `const mockProfile = {
  id: "u-123",
  email: "test@example.com",
  role: "user",
  tier: "free",
  analysesUsed: 0,
  monthlyLimit: 10,
  initials: "TE"
};`;

content = content.replace('render(<DashboardContainer status="complete" error={null} quotaLabel="" />);', 
`${mockProfile}
    render(<DashboardContainer profile={mockProfile as any} status="complete" error={null} quotaLabel="" />);`);

fs.writeFileSync(path, content);
