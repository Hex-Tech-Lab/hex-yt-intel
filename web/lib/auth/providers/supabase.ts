import { createClient } from '@/utils/supabase/server';
import { cookies } from 'next/headers';

export async function getSupabaseUser() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function signOutSupabase(): Promise<void> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  await supabase.auth.signOut();
}
