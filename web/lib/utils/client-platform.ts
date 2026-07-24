/**
 * Client-platform derivation from a request's `User-Agent` header.
 *
 * RCA context (2026-07-24): an analysis run from an iPad silently landed
 * under a *different* Supabase Auth account than the user's main login,
 * purely because that device happened to be signed into a different
 * email. The data was re-pointed after the fact, but there was (and still
 * is, absent this) no UI signal for "which device did I run this from" to
 * catch the next instance before it causes confusion. This is a best-effort,
 * cosmetic signal only — never used for auth, billing, or any security
 * decision, so a spoofed/missing UA has no consequence beyond an "unknown"
 * chip in the history list.
 *
 * `ios-app` / `android-app` are reserved for native mobile apps ("when we
 * have them" per the user) — unreachable from a browser UA today, but kept
 * in the union now so surfacing them later needs no schema/type migration,
 * only a UA (or explicit client header) check added below.
 */
export type ClientPlatform =
  | 'ios'
  | 'ios-app'
  | 'android'
  | 'android-app'
  | 'macos'
  | 'windows'
  | 'linux'
  | 'web';

/**
 * Derive a coarse platform label from a raw `User-Agent` header string.
 * Order matters: iPadOS 13+ Safari masquerades as macOS unless it also
 * advertises touch support (`Macintosh` + `Mobile` combos, or the classic
 * `iPad` token pre-13), so iOS/iPadOS checks run before the macOS check.
 * Returns `'web'` (generic desktop browser) as the catch-all fallback, and
 * `null` only when there is no UA at all to classify.
 */
export function detectClientPlatform(userAgent: string | null | undefined): ClientPlatform | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();

  // Explicit iOS/iPadOS signals (including iPadOS 13+ desktop-mode masquerade).
  if (/iphone|ipod|ipad/.test(ua)) return 'ios';
  if (ua.includes('macintosh') && ua.includes('mobile')) return 'ios';

  if (ua.includes('android')) return 'android';
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('macintosh') || ua.includes('mac os x')) return 'macos';
  if (ua.includes('linux')) return 'linux';

  return 'web';
}
