const fs = require('fs');
const path = 'web/lib/adapters/PaddleBillingAdapter.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `async processSubscriptionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }> {\n    try {`,
  `async processSubscriptionEvent(rawPayload: WebhookPayload): Promise<{ success: boolean; error?: string }> {\n    try {\n      const parsed = PaddleWebhookSchema.safeParse(rawPayload);\n      if (!parsed.success) {\n        console.warn('[PaddleBillingAdapter] Schema validation dropped payload', parsed.error.issues);\n        Sentry.captureMessage('PaddleBillingAdapter schema validation dropped payload', { level: 'warning', extra: { issues: parsed.error.issues, payload: rawPayload } });\n        return { success: false, error: 'Invalid webhook payload schema' };\n      }\n      const payload = parsed.data as any;`
);

content = content.replace(
  `async processTransactionEvent(payload: WebhookPayload): Promise<{ success: boolean; error?: string }> {\n    try {`,
  `async processTransactionEvent(rawPayload: WebhookPayload): Promise<{ success: boolean; error?: string }> {\n    try {\n      const parsed = PaddleWebhookSchema.safeParse(rawPayload);\n      if (!parsed.success) {\n        console.warn('[PaddleBillingAdapter] Schema validation dropped payload', parsed.error.issues);\n        Sentry.captureMessage('PaddleBillingAdapter schema validation dropped payload', { level: 'warning', extra: { issues: parsed.error.issues, payload: rawPayload } });\n        return { success: false, error: 'Invalid webhook payload schema' };\n      }\n      const payload = parsed.data as any;`
);

content = content.replace(/const userId = data\.custom_data\?\.user_id \|\| data\.custom_data\?\.userId;/g, 'const userId = data.custom_data?.userId;');
content = content.replace(/let planTier = data\.custom_data\?\.plan_tier \|\| data\.custom_data\?\.planTier;/g, 'let planTier = data.custom_data?.planTier;');

fs.writeFileSync(path, content);
