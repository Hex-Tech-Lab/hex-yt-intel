const fs = require('fs');
const path = 'web/components/templates/console/ViewModeToggle.tsx';
let content = fs.readFileSync(path, 'utf8');

// Remove import useEntitlements
content = content.replace('import { useEntitlements } from "@/lib/hooks/useEntitlements";\n', '');

const oldHookCall = `  const { effectiveViewMode: viewMode, setViewMode } = useEffectiveViewMode();
  const { isFounder, isPro, isLoading } = useEntitlements();
  const [pricingModalOpen, setPricingModalOpen] = useState(false);

  const isProEntitled = isFounder || isPro;

  const handleToggle = (mode: ConsoleViewMode) => {
    if (mode === "pro" && !isProEntitled && !isLoading) {`;

const newHookCall = `  const { effectiveViewMode: viewMode, setViewMode, canAccessPro, isLoading } = useEffectiveViewMode();
  const [pricingModalOpen, setPricingModalOpen] = useState(false);

  const handleToggle = (mode: ConsoleViewMode) => {
    if (mode === "pro" && !canAccessPro && !isLoading) {`;

content = content.replace(oldHookCall, newHookCall);
content = content.replace(/!isProEntitled/g, '!canAccessPro');

fs.writeFileSync(path, content);
