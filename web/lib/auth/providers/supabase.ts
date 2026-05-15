/**
 * Supabase SSR Auth Provider
 * Uses Supabase built-in Google OAuth (no GCP credentials needed)
 */

import { createClient } from '@/utils/supabase/server';

export async function getSupabaseUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function getSupabaseSession() {
  const user = await getSupabaseUser();
  return user ? { user } : null;
}

export async function signOutSupabase() {
  const supabase = await createClient();
  await supabase.auth.signOut();
}
