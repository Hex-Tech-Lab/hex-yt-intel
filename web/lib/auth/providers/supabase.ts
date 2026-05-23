import { getSupabaseClientWithAuth } from '@/lib/supabase';

export async function getSupabaseUser() {
  const supabase = await getSupabaseClientWithAuth();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOutSupabase(): Promise<void> {
  const supabase = await getSupabaseClientWithAuth();
  await supabase.auth.signOut();
}
