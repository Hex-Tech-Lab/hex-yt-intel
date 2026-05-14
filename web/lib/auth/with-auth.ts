import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from './nextauth-config';

// Augment NextAuth types so session.user.id is typed — eliminates all (session.user as any).id casts
declare module 'next-auth' {
  interface User {
    id: string;
  }
  interface Session {
    user: User & {
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export async function withAuth(
  handler: (userId: string) => Promise<NextResponse>
): Promise<NextResponse> {
  const session = await getServerSession(authConfig);

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  if (!userId) {
    return NextResponse.json({ error: 'User ID not found in session' }, { status: 401 });
  }

  return handler(userId);
}
