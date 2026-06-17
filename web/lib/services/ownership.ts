import { getSupabaseClientWithAuth } from '@/lib/supabase';

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
  select: string = '*'
): Promise<OwnershipResult<T>> {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return { data: null, error: 'Unauthorized' };
  }

  const { data, error } = await supabase
    .from(table)
    .select(select)
    .eq('id', resourceId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('[ownership] DB query failed:', error);
    return { data: null, error: 'InternalError' };
  }
  if (!data) {
    return { data: null, error: 'NotFound' };
  }

  return { data: data as T, error: null };
}
