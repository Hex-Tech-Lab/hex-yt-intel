import fs from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';
import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | hex-yt-intel',
  description: 'Privacy Policy for hex-yt-intel',
};

export default async function PrivacyPolicyPage() {
  const filePath = path.join(process.cwd(), '..', 'docs', 'legal', 'privacy-policy.md');
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    content = '# Privacy Policy\n\nThis document is currently being compiled by our legal team. Please check back later.';
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30 font-sans">
      <header className="border-b border-cyan-500/10 px-6 py-4 bg-black/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3 text-lg font-semibold tracking-tight text-cyan-500">
            <div className="w-6 h-6 bg-gradient-to-br from-cyan-500 to-sky-400 rounded-md" />
            <span>hex-yt-intel</span>
          </Link>
          <nav className="flex gap-6 text-sm text-white/60">
            <Link href="/terms-and-conditions" className="hover:text-cyan-500 transition-colors">Terms</Link>
            <Link href="/refund-policy" className="hover:text-cyan-500 transition-colors">Refunds</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-[900px] mx-auto px-6 py-24">
        <div className="bg-[#1A1A1A] border border-[#404040] p-8 md:p-12 shadow-[0_1px_3px_rgba(255,255,255,0.1),0_2px_6px_rgba(255,255,255,0.08),0_4px_12px_rgba(255,255,255,0.05)]">
          <article className="prose prose-invert max-w-none prose-p:text-[#D4D4D8] prose-p:text-[16px] prose-p:leading-[1.6] prose-p:tracking-[0.5px] prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-[32px] prose-h2:text-[24px] prose-a:text-cyan-500 hover:prose-a:text-cyan-400 prose-strong:text-white prose-li:text-[#D4D4D8]">
            <ReactMarkdown>{content}</ReactMarkdown>
          </article>
        </div>
      </main>
    </div>
  );
}
