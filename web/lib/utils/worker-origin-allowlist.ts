/**
 * SSRF allowlist for outbound Vercel → Cloudflare Worker calls (Bouncer gate).
 *
 * Single source of truth for the trusted worker origins — previously a
 * copy-pasted `new Set([...])` literal in both WorkerIngestionAdapter.ts and
 * worker-llm.ts, which drifted silently when the UAT worker subdomain
 * (youtube-intelligence-worker-uat) was deployed and video ingestion began
 * 500ing on UAT with "Worker URL origin ... is not in approved allowlist".
 *
 * Trust model: every worker on this Cloudflare account publishes under the
 * account's own workers.dev zone, so a suffix rule over `.hex-tech-lab.workers.dev`
 * admits prod (yt-intel) and UAT (youtube-intelligence-worker-uat) plus future
 * account workers without code changes; the leading dot requires a proper
 * subdomain boundary (a lookalike like `evil-hex-tech-lab.workers.dev` does NOT
 * match). The actual worker URL still comes from the environment
 * (NEXT_PUBLIC_WORKER_URL / CLOUDFLARE_WORKER_URL) — this list only validates it.
 */
const TRUSTED_WORKER_HOSTS: readonly string[] = [
  'yt-intel.hex-tech-lab.workers.dev',
  'youtube-intelligence-worker-uat.hex-tech-lab.workers.dev',
];

const TRUSTED_WORKER_HOST_SUFFIX = '.hex-tech-lab.workers.dev';

export function isTrustedWorkerOrigin(hostname: string): boolean {
  if (TRUSTED_WORKER_HOSTS.includes(hostname)) return true;
  return hostname.endsWith(TRUSTED_WORKER_HOST_SUFFIX);
}
