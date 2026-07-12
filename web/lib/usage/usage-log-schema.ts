import { z } from 'zod';

export const USAGE_LOG_SCHEMA = z.object({
  user_id: z.string(),
  action: z.string().min(1, 'Action cannot be empty'),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: z.string().datetime({ message: 'created_at must be a valid ISO 8601 datetime string' }),
});

export type UsageLog = z.infer<typeof USAGE_LOG_SCHEMA>;
