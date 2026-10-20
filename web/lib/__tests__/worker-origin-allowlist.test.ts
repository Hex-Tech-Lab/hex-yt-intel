import { describe, it, expect } from 'vitest';
import { isTrustedWorkerOrigin } from '@/lib/utils/worker-origin-allowlist';

describe('isTrustedWorkerOrigin (SSRF bouncer allowlist)', () => {
  it('admits the production worker host', () => {
    expect(isTrustedWorkerOrigin('yt-intel.hex-tech-lab.workers.dev')).toBe(true);
  });

  it('admits the UAT worker host (video ingestion 500 regression)', () => {
    expect(isTrustedWorkerOrigin('youtube-intelligence-worker-uat.hex-tech-lab.workers.dev')).toBe(true);
  });

  it('admits any proper subdomain of the account workers.dev zone (wildcard rule)', () => {
    expect(isTrustedWorkerOrigin('some-future-worker.hex-tech-lab.workers.dev')).toBe(true);
  });

  it('rejects lookalike hosts that merely END with the zone string (no subdomain boundary)', () => {
    expect(isTrustedWorkerOrigin('evil-hex-tech-lab.workers.dev')).toBe(false);
  });

  it('rejects unrelated hosts', () => {
    expect(isTrustedWorkerOrigin('attacker.example.com')).toBe(false);
    expect(isTrustedWorkerOrigin('workers.dev')).toBe(false);
    expect(isTrustedWorkerOrigin('hex-tech-lab.workers.dev.evil.com')).toBe(false);
  });

  it('rejects internal targets (SSRF class)', () => {
    expect(isTrustedWorkerOrigin('localhost')).toBe(false);
    expect(isTrustedWorkerOrigin('169.254.169.254')).toBe(false);
    expect(isTrustedWorkerOrigin('internal.svc.cluster.local')).toBe(false);
  });
});
