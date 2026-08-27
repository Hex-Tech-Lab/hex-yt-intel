const fs = require('fs');
const path = 'web/lib/adapters/PaddleBillingAdapter.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `return { success: false, error: 'Missing user_id in custom_data' };`,
  `Sentry.captureMessage('PaddleBillingAdapter: Missing user_id in custom_data', { level: 'warning', extra: { payload: data } });\n        return { success: false, error: 'Missing user_id in custom_data' };`
);

content = content.replace(
  `return { success: false, error: 'Missing user_id in transaction custom_data' };`,
  `Sentry.captureMessage('PaddleBillingAdapter: Missing user_id in transaction custom_data', { level: 'warning', extra: { payload: data } });\n        return { success: false, error: 'Missing user_id in transaction custom_data' };`
);

fs.writeFileSync(path, content);
