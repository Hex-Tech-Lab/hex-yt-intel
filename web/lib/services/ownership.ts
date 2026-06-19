import type { AuthPort, AnalysisPersistencePort, ChatPersistencePort } from '@/lib/ports';
import { SupabaseAuthAdapter } from '@/lib/adapters/SupabaseAuthAdapter';
import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';

export interface OwnershipResult<T> {
  data: T | null;
  error: 'Unauthorized' | 'NotFound' | 'InternalError' | null;
}

/**
 * Standardized ownership guard for API routes.
 * Ensures the requesting user owns the resource they are accessing.
 */
export async function verifyResourceOwnership<T>(
  resourceId: string,
  table: 'analyses' | 'chat_conversations',
  select: string = '*',
  auth: AuthPort = new SupabaseAuthAdapter(),
  persistence: AnalysisPersistencePort & ChatPersistencePort = new SupabasePersistenceAdapter()
): Promise<OwnershipResult<T>> {
  const identity = await auth.authenticate();

  if (!identity) {
    return { data: null, error: 'Unauthorized' };
  }

  try {
    let data: any = null;
    if (table === 'analyses') {
      data = await persistence.verifyOwnership({
        analysisId: resourceId,
        userId: identity.userId,
        select,
      });
    } else {
      data = await persistence.verifyChatOwnership({
        conversationId: resourceId,
        userId: identity.userId,
        select,
      });
    }

    if (!data) {
      return { data: null, error: 'NotFound' };
    }

    return { data: data as T, error: null };
  } catch (error) {
    console.error('[ownership] DB query failed:', error);
    return { data: null, error: 'InternalError' };
  }
}
