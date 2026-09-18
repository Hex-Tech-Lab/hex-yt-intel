/**
 * Resolves the Next.js `output` mode for this build.
 *
 * Why this exists: under Turbopack production builds, Next only emits
 * .next/next-server.js.nft.json when `output: 'standalone'` is set, but
 * Vercel's builder does its own function tracing and its onBuildComplete
 * step ENOENTs on that file when standalone output is active (real
 * regression hit on the Next 16.3.3 bump, 2026-09-15 — see the comment in
 * next.config.ts). Conversely, a non-Vercel (Docker) deploy NEEDS
 * standalone. The previous heuristic checked only `process.env.VERCEL`,
 * which is the sole signal and can be unavailable/masked — silently
 * recreating the packaging failure. This makes the deploy target explicit
 * and repo-controlled:
 *
 * 1. `DEPLOY_TARGET` (explicit, repo-controlled, primary signal):
 *    'vercel' (case-insensitive)  → no standalone (Vercel builder traces).
 *    any other value (e.g. 'docker', 'self-hosted') → standalone.
 * 2. `VERCEL` (platform-injected fallback, documented): truthy → no
 *    standalone.
 * 3. Neither set → standalone, with a loud warning so an ambiguous
 *    deployment target is visible in build logs instead of silent.
 *
 * Vercel's builder strips `output` itself in any case (see next.config.ts
 * comment), so the residual risk of a wrong local choice is contained —
 * but the warning + explicit flag remove the silent ambiguity.
 */
export type NextOutputMode = 'standalone' | undefined;
export type OutputModeSource = 'explicit' | 'vercel-fallback' | 'default';

export interface OutputModeResult {
  output: NextOutputMode;
  source: OutputModeSource;
}

export interface DeployEnv {
  DEPLOY_TARGET?: string | undefined;
  VERCEL?: string | undefined;
  [key: string]: string | undefined;
}

export function resolveNextOutputMode(env: DeployEnv): OutputModeResult {
  const target = env.DEPLOY_TARGET?.trim().toLowerCase();
  if (target) {
    if (target === 'vercel') {
      return { output: undefined, source: 'explicit' };
    }
    return { output: 'standalone', source: 'explicit' };
  }

  // Documented fallback: platform-injected VERCEL marker.
  if (env.VERCEL) {
    return { output: undefined, source: 'vercel-fallback' };
  }

  // Ambiguous target (local build / masked env): standalone for
  // non-Vercel (Docker) deploys — but say so loudly, don't fail silently.
  return { output: 'standalone', source: 'default' };
}

export function describeAmbiguousTargetWarning(result: OutputModeResult): string | null {
  if (result.source !== 'default') return null;
  return [
    '[next.config] No DEPLOY_TARGET or VERCEL env var set — deployment target is ambiguous.',
    "Falling back to output: 'standalone' (non-Vercel/Docker behavior).",
    "If this build targets Vercel and the standalone artifacts leak into the deploy, set DEPLOY_TARGET=vercel explicitly.",
  ].join(' ');
}
