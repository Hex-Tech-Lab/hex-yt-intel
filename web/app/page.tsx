import { redirect } from "next/navigation";
import { getSupabaseClientWithAuth } from "@/lib/supabase"; // Corrected path
import { LandingPage } from './landing-page';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: { [key: string]: string | string[] | undefined };
}

export default async function RootPage({ searchParams }: PageProps) {
  // Resolve search parameters directly
  const forceLanding = searchParams?.v === "landing";

  if (forceLanding) {
    // Render public marketing landing component cleanly
    return <LandingPage />;
  }

  // Evaluate active session status to prevent auth middleware leaks
  const supabase = await getSupabaseClientWithAuth();
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    return <LandingPage />;
  }

  // Redirect authenticated sessions directly into the Atlas workflow
  redirect("/atlas");
}
