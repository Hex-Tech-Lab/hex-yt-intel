import fs from 'fs';
import path from 'path';
import ReactMarkdown from 'react-markdown';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sub-processors | Hex-YT Intel',
  description: 'A complete list of third-party sub-processors used by Hex-YT Intel for data processing.',
};

export default function SubProcessorsPage() {
  const filePath = path.join(process.cwd(), '../docs/legal/sub-processors.md');
  const content = fs.readFileSync(filePath, 'utf8');

  return (
    <div className="min-h-screen bg-black text-white selection:bg-cyan-500/30">
      {/* Background gradients aligned with Obsidian-Escher */}
      <div className="fixed inset-0 z-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,#1A1A1A_0%,#000000_100%)]" />
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />
      </div>

      {/* Content Container */}
      <main className="relative z-10 max-w-4xl mx-auto px-6 py-24">
        <article className="prose prose-invert prose-cyan max-w-none prose-headings:font-bold prose-headings:tracking-tight prose-a:text-cyan-400 hover:prose-a:text-cyan-300 prose-table:border-collapse prose-th:border prose-th:border-cyan-500/20 prose-th:bg-[#1A1A1A] prose-th:p-4 prose-td:border prose-td:border-white/10 prose-td:p-4">
          <ReactMarkdown>{content}</ReactMarkdown>
        </article>

        <div className="mt-16 pt-8 border-t border-cyan-500/10">
          <a href="/" className="text-sm text-cyan-500 hover:text-cyan-400 transition-colors">
            &larr; Back to Home
          </a>
        </div>
      </main>
    </div>
  );
}
