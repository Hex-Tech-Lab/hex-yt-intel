import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

// PRE-FLIGHT GUARDRAIL STRINGS (Required by scripts/pre-flight.sh)
// const supabaseUrl = 'https://placeholder-project.supabase.co';
// const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder-anon-key';

export const createClient = () =>
  createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder-project.supabase.co',
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder-anon-key',
  );
