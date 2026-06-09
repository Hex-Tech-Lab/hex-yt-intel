import ReactMarkdown from 'react-markdown';
import Link from 'next/link';

interface LegalPageProps {
  content: string;
}

export function LegalPage({ content }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-black text-ink selection:bg-accent/30 font-sans overflow-x-hidden">
      {/* Subtle background element to match LandingThree feel */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-20%,#06B6D415,transparent_50%)] pointer-events-none" />
      
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md border-b border-line-faint">
        <div className="max-w-[1200px] mx-auto h-16 px-6 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight text-accent hover:opacity-80 transition-opacity">
            <div className="w-6 h-6 bg-cyan-electric clip-tessellate" />
            <span>hex-yt-intel</span>
          </Link>
          <nav className="flex gap-6 text-sm text-ink-secondary">
            <Link href="/terms-and-conditions" className="hover:text-accent transition-colors">Terms</Link>
            <Link href="/privacy-policy" className="hover:text-accent transition-colors">Privacy</Link>
            <Link href="/refund-policy" className="hover:text-accent transition-colors">Refunds</Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-32 pb-24">
        <div className="animate-slideInDown">
          <article className="prose prose-invert prose-cyan max-w-none 
            prose-headings:tracking-tight prose-headings:font-semibold
            prose-h1:text-[36px] prose-h1:mb-8 prose-h1:text-white
            prose-h2:text-[24px] prose-h2:mt-12 prose-h2:mb-4 prose-h2:text-white/90
            prose-p:text-[16px] prose-p:leading-relaxed prose-p:text-ink-secondary
            prose-strong:text-white prose-strong:font-semibold
            prose-ul:list-disc prose-ul:pl-6
            prose-li:text-ink-secondary prose-li:my-2
            prose-a:text-accent hover:prose-a:text-accent-ink transition-colors
            prose-table:border-collapse prose-th:border prose-th:border-line-strong prose-th:bg-surface-raised prose-th:p-4 prose-td:border prose-td:border-line prose-td:p-4">
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        </div>
      </main>

      <footer className="relative z-10 border-t border-line-faint py-12 bg-bg/50">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="text-ink-muted text-[12px]">
            &copy; {new Date().getFullYear()} Hex-YT Intel. All rights reserved.
          </div>
          <div className="flex gap-6 text-ink-muted text-[12px]">
            <Link href="/privacy-policy" className="hover:text-accent transition-colors">Privacy Policy</Link>
            <Link href="/terms-and-conditions" className="hover:text-accent transition-colors">Terms of Service</Link>
            <Link href="/legal/sub-processors" className="hover:text-accent transition-colors">Sub-processors</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
