const fs = require('fs');
const path = 'web/lib/adapters/PaddleBillingAdapter.ts';
let content = fs.readFileSync(path, 'utf8');

const newSchemas = `export const WebhookCustomDataSchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const raw = val as Record<string, unknown>;
    const rawUserId = raw.user_id ?? raw.userId;
    const rawPlanTier = raw.plan_tier ?? raw.planTier;
    const normalizedUserId = typeof rawUserId === "string" && rawUserId.trim() !== "" ? rawUserId.trim() : undefined;
    const normalizedPlanTier = typeof rawPlanTier === "string" && rawPlanTier.trim() !== "" ? rawPlanTier.trim().toLowerCase() : undefined;
    return {
      ...raw,
      ...(normalizedUserId ? { userId: normalizedUserId, user_id: normalizedUserId } : {}),
      ...(normalizedPlanTier ? { planTier: normalizedPlanTier, plan_tier: normalizedPlanTier } : {}),
    };
  },
  z.object({
    userId: z.string().optional(),
    user_id: z.string().optional(),
    planTier: z.string().optional(),
    plan_tier: z.string().optional(),
  }).passthrough().nullable().optional()
);

export const PaddleWebhookSchema = z.object({
  event_id: z.string().optional(),
  event_type: z.string(),
  occurred_at: z.string().optional(),
  data: z.object({
    id: z.string().optional(),
    customer_id: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    custom_data: WebhookCustomDataSchema,
    items: z.array(z.object({
      price: z.object({
        id: z.string().optional(),
        custom_data: WebhookCustomDataSchema,
      }).passthrough().nullable().optional(),
    }).passthrough()).nullable().optional(),
    scheduled_change: z.object({
      action: z.string().nullable().optional(),
      effective_at: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
    current_billing_period: z.object({
      ends_at: z.string().nullable().optional(),
    }).passthrough().nullable().optional(),
  }).passthrough(),
}).passthrough();`;

content = content.replace(/const WebhookCustomDataSchema = z\.preprocess\([\s\S]*?\}\)\.passthrough\(\);/, newSchemas);
fs.writeFileSync(path, content);
