const fs = require('fs');
const path = 'web/components/containers/DashboardContainer.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  '{effectiveViewMode === "simple" ? (\n                                    {(() => {',
  '{effectiveViewMode === "simple" ? (() => {'
);
fs.writeFileSync(path, content);
