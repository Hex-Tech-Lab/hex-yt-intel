'use client';

import ReactMarkdown from 'react-markdown';
import Link from 'next/link';
import { Footer } from '@/components/Footer';

interface LegalPageProps {
  content: string;
}

export function LegalPage({ content }: LegalPageProps) {
  return (
    <div className="min-h-screen bg-black text-ink selection:bg-accent/30 font-sans overflow-x-hidden">
      {/* Subtle background element to match LandingThree feel */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-20%,#06B6D415,transparent_50%)] pointer-events-none" />
      
      <header className="fixed top-0 left-0 right-0 z-50 bg-black/70 backdrop-blur-md border-b border-line-faint h-16">
        <div className="max-w-[1200px] mx-auto h-full px-6 flex items-center justify-between">
          <Link href="/?v=landing" className="flex items-center gap-3 text-lg font-semibold tracking-tight text-accent hover:opacity-80 transition-opacity">
            <div className="w-6 h-6 bg-accent clip-tessellate" />
            <span>hex-yt-intel</span>
          </Link>
          <nav className="flex gap-6 text-sm text-ink-secondary">
            <Link href="/terms-and-conditions" className="hover:text-accent transition-colors">Terms</Link>
            <Link href="/privacy-policy" className="hover:text-accent transition-colors">Privacy</Link>
            <Link href="/refund-policy" className="hover:text-accent transition-colors">Refunds</Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 pt-40 pb-32">
        <div className="animate-slideInDown">
          <article className="prose prose-invert prose-cyan max-w-none 
            prose-headings:tracking-tight prose-headings:font-semibold
            prose-h1:text-headline-lg prose-h1:mb-16 prose-h1:text-white
            prose-h2:text-headline-md prose-h2:mt-24 prose-h2:mb-8 prose-h2:text-white/90
            prose-p:text-body-base prose-p:leading-relaxed prose-p:text-ink-secondary prose-p:my-10
            prose-strong:text-white prose-strong:font-semibold
            prose-ul:list-disc prose-ul:pl-8 prose-ul:my-10
            prose-li:text-ink-secondary prose-li:my-5
            prose-a:text-accent hover:prose-a:text-accent-ink transition-colors
            prose-table:border-collapse prose-table:my-12 prose-th:border prose-th:border-line-strong prose-th:bg-surface-raised prose-th:p-4 prose-td:border prose-td:border-line prose-td:p-4">
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        </div>
      </main>

      <Footer />

      {/* Aggressive spacing overrides using global CSS block */}
      <style dangerouslySetInnerHTML={{ __html: `
        .prose p {
          margin-top: 2.5rem !important;
          margin-bottom: 2.5rem !important;
          line-height: 1.8 !important;
          display: block !important;
        }
        .prose h1 {
          margin-bottom: 3.5rem !important;
          font-size: 2.5rem !important;
          display: block !important;
        }
        .prose h2 {
          margin-top: 4.5rem !important;
          margin-bottom: 2rem !important;
          font-size: 1.75rem !important;
          display: block !important;
        }
        .prose ul, .prose ol {
          margin-top: 2rem !important;
          margin-bottom: 2rem !important;
          display: block !important;
          list-style-type: disc !important;
          padding-left: 2.5rem !important;
        }
        .prose li {
          margin-top: 1rem !important;
          margin-bottom: 1rem !important;
          display: list-item !important;
        }
        .prose table {
          margin-top: 3rem !important;
          margin-bottom: 3rem !important;
          width: 100% !important;
          border-collapse: collapse !important;
        }
      `}} />
    </div>
  );
}
