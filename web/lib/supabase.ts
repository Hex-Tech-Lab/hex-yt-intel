import { createClient } from '@supabase/supabase-js';
import { env } from './env';

export function getSupabaseClient() {
  return createClient(env.supabaseUrl, env.supabaseAnonKey);
}

export function getSupabaseServiceClient() {
  const serviceKey = env.supabaseServiceRoleKey;
  if (!serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is not set');
  }
  return createClient(env.supabaseUrl, serviceKey);
}
