'use client';

import { Skeleton } from '@astryxdesign/core/Skeleton';
import type { StoredExecutiveDigest } from '@/lib/ports/ExecutiveDigestPorts';

export interface ExecutiveDigestCardProps {
  digest: StoredExecutiveDigest | null;
  loading: boolean;
}

/**
 * Dimension 0 — the executive digest card. Three tiers (Snapshot / Key
 * Takeaways / Overview) synthesized once from the completed analysis. It is
 * uncounted — labelled "Dimension 0" and rendered above the 1..11 dimensions,
 * never inside their grid — so nothing keyed off the 1..11 range is affected.
 */
export function ExecutiveDigestCard({ digest, loading }: ExecutiveDigestCardProps) {
  if (!digest && !loading) return null;

  return (
    <section
      aria-label="Executive digest"
      className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/[0.06] p-2 sm:p-3"
    >
      <header className="mb-3 flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)]/20 font-mono text-[11px] font-bold text-[var(--accent-ink)]">
          0
        </span>
        <h2 className="font-mono text-sm font-semibold tracking-tight text-[var(--ink)]">Executive Digest</h2>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-[var(--ink-muted)]">
          Overview · uncounted
        </span>
      </header>

      {loading && !digest ? (
        <DigestSkeleton />
      ) : digest ? (
        <div className="flex flex-col gap-2.5">
          {digest.snapshot && (
            <Tier label="Snapshot">
              <p className="text-sm leading-relaxed text-[var(--ink-secondary)]">{digest.snapshot}</p>
            </Tier>
          )}

          {digest.takeaways.length > 0 && (
            <Tier label="Key Takeaways">
              <ul className="flex flex-col gap-1.5">
                {digest.takeaways.map((t) => (
                  <li key={t} className="flex gap-2 text-sm leading-relaxed text-[var(--ink-secondary)]">
                    <span aria-hidden className="mt-[0.4em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </Tier>
          )}

          {digest.overview && (
            <Tier label="Overview">
              <div className="flex flex-col gap-2">
                {digest.overview
                  .split(/\n{2,}/)
                  .map((p) => p.trim())
                  .filter(Boolean)
                  .map((p) => (
                    <p key={p} className="text-sm leading-relaxed text-[var(--ink-secondary)]">
                      {p}
                    </p>
                  ))}
              </div>
            </Tier>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Tier({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[var(--accent-ink)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function DigestSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton width="33%" height={12} index={0} />
      <Skeleton width="100%" height={12} index={1} />
      <Skeleton width="83%" height={12} index={2} />
      <div className="mt-2">
        <Skeleton width="25%" height={12} index={3} />
      </div>
      <Skeleton width="67%" height={12} index={4} />
    </div>
  );
}
