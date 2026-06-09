import Link from 'next/link';

export function Footer() {
  return (
    <footer className="relative z-10 border-t border-line-faint py-12 bg-bg/50">
      <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="text-ink-muted text-[12px] font-mono tracking-tight">
          &copy; {new Date().getFullYear()} HEX-YT INTEL. PROVENANCE ASSURED.
        </div>
        <div className="flex gap-8 text-ink-muted text-[11px] font-mono uppercase tracking-widest">
          <Link href="/privacy-policy" className="hover:text-accent transition-colors">Privacy</Link>
          <Link href="/terms-and-conditions" className="hover:text-accent transition-colors">Terms</Link>
          <Link href="/refund-policy" className="hover:text-accent transition-colors">Refunds</Link>
          <Link href="/legal/sub-processors" className="hover:text-accent transition-colors">Sub-processors</Link>
        </div>
      </div>
    </footer>
  );
}
