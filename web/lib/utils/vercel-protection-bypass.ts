/**
 * Resolves the Vercel deployment protection bypass secret / header.
 * In Preview/UAT environments where Vercel Deployment Protection is active,
 * requests require the `x-vercel-protection-bypass` header or cookie to avoid 401.
 */
export function getVercelProtectionBypassHeaders(): Record<string, string> {
  // 1. Client-side: check document.cookie
  if (typeof document !== 'undefined') {
    const cookieMatch = document.cookie.match(
      /(?:^|;\s*)(?:x-vercel-protection-bypass|__vercel_protection_bypass)=([^;]+)/
    );
    if (cookieMatch?.[1]) {
      return { 'x-vercel-protection-bypass': decodeURIComponent(cookieMatch[1]) };
    }
  }

  // 2. Client-side: check window.location.search (?x-vercel-protection-bypass=...)
  if (typeof window !== 'undefined') {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const param = urlParams.get('x-vercel-protection-bypass');
      if (param) {
        return { 'x-vercel-protection-bypass': param };
      }
    } catch {
      // ignore
    }
  }

  // 3. Environment variable fallback (set in preview/UAT builds)
  const envSecret =
    process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS ||
    process.env.VERCEL_PROTECTION_BYPASS ||
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
    'lqzE0rsJ29UO2XZHNJErMu5Ce7x0ca5i';

  if (envSecret) {
    return { 'x-vercel-protection-bypass': envSecret };
  }

  return {};
}
