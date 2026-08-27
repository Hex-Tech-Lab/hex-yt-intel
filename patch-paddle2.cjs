const fs = require('fs');
const path = 'web/lib/adapters/PaddleBillingAdapter.ts';
let content = fs.readFileSync(path, 'utf8');

const schemaDef = `const WebhookCustomDataSchema = z.preprocess((val) => {
  if (typeof val === 'object' && val !== null) {
    return {
      userId: (val as any).user_id || (val as any).userId,
      planTier: (val as any).plan_tier || (val as any).planTier,
      ...val
    };
  }
  return val;
}, z.object({
  userId: z.string().optional(),
  planTier: z.string().optional(),
}).passthrough());

const PaddleWebhookSchema = z.object({
  event_type: z.string(),
  occurred_at: z.string().optional(),
  data: z.object({
    id: z.string().optional(),
    status: z.string().optional(),
    customer_id: z.string().optional(),
    subscription_id: z.string().optional(),
    custom_data: WebhookCustomDataSchema.optional(),
    current_billing_period: z.object({
      starts_at: z.string().optional(),
      ends_at: z.string().optional(),
    }).passthrough().optional(),
    items: z.array(z.any()).optional(),
  }).passthrough()
}).passthrough();
`;

content = content.replace('export class PaddleBillingAdapter', schemaDef + '\nexport class PaddleBillingAdapter');

fs.writeFileSync(path, content);
