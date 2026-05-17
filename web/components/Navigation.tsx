import type { User } from 'next-auth';

export async function Navigation({ user }: { user?: User | null }) {
  const safeUser = user ?? null;

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
      {/* Logo / Title (Left) */}
      <div className="flex items-center gap-2">
        <span className="text-xl font-bold text-gray-900">Hex-YT-Intel</span>
      </div>

      {/* User Menu (Right) */}
      <div className="flex items-center gap-4">
        {safeUser && (
          <>
            <span className="text-sm text-gray-600">{safeUser.email}</span>
            <form action="/api/auth/signout" method="POST">
              <button
                type="submit"
                className="px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded"
              >
                Sign Out
              </button>
            </form>
          </>
        )}
      </div>
    </nav>
  );
}
