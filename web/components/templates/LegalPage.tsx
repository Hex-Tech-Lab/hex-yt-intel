'use client';

import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import DOMPurify from 'isomorphic-dompurify';
import Link from 'next/link';
import { Footer } from '@/components/Footer';
import { Icon, MonoLabel } from '@/components/templates/_shared/primitives';

interface LegalPageProps {
  content: string;
}

export function LegalPage({ content }: LegalPageProps) {
  // Clean content for rendering (strip the title and date if we are rendering them custom)
  // But standard ReactMarkdown is fine if we style it perfectly.
  
  return (
    <div className="min-h-screen min-w-[320px] bg-[#0B0E14] text-[#E2E8F0] selection:bg-[#06B6D430] font-sans">
      {/* Brand Aesthetic Background */}
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_50%_-20%,#06B6D415,transparent_50%)] pointer-events-none" />
      
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#11141DCC] backdrop-blur-xl border-b border-[#1E293B]">
        <div className="max-w-[1200px] mx-auto h-16 px-8 flex items-center justify-between">
          <Link href="/?v=landing" className="flex items-center gap-3 group">
            <span className="flex items-center justify-center w-7 h-7 bg-[#0891B2] text-[#0B0E14] rounded-lg shadow-[0_4px_12px_rgba(6,182,212,0.4)] transition-transform group-hover:scale-105">
              <Icon icon="solar:graph-up-linear" size={18} />
            </span>
            <span className="font-mono text-[15px] font-bold tracking-[0.04em] text-[#E2E8F0]">
              HEX{"\u00b7"}YT{"\u00b7"}INTEL
            </span>
          </Link>
          <nav className="flex gap-4 items-center">
            <Link href="/pricing" className="btn-secondary" style={{ textDecoration: "none" }}>Pricing</Link>
            <Link href="/auth/signin" className="btn-primary" style={{ textDecoration: "none" }}>
              <Icon icon="solar:sun-bold-duotone" size={16} />
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-[1280px] mx-auto px-12 pt-48 pb-32">
        <div className="max-w-[800px] w-full">
          {/* Breadcrumbs & Title Section */}
          <div className="mb-16 animate-hx-rise">
             <div className="flex items-center gap-2 mb-6">
                <Link href="/?v=landing" className="text-[11px] font-mono uppercase tracking-widest text-[#64748B] hover:text-[#06B6D4] transition-colors">Home</Link>
                <span className="text-[#334155] font-mono text-[10px]">/</span>
                <span className="text-[11px] font-mono uppercase tracking-widest text-[#06B6D4]">Legal</span>
             </div>

             <MonoLabel index="//" className="mb-4">Internal Register</MonoLabel>
             
             {/* Note: The Markdown usually starts with an H1, we let it render but we control the spacing */}
             <div className="prose-container">
                <article className="prose prose-invert prose-cyan max-w-none">
                  <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
                </article>
             </div>
          </div>
        </div>
      </main>

      <Footer />

      {/* 
        PIXEL-PERFECT DESIGN SYSTEM INJECTION
        Directly mapping from colors_and_type.css and motion.css specs
      */}
      <style dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(`
        @keyframes hx-rise { 
          from { opacity: 0; transform: translateY(12px); } 
          to { opacity: 1; transform: translateY(0); } 
        }
        .animate-hx-rise { animation: hx-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both; }

        .prose h1 {
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 48px !important;
          line-height: 1.05 !important;
          letter-spacing: -0.02em !important;
          margin-bottom: 12px !important;
          color: #E2E8F0 !important;
        }

        .prose p:first-of-type strong {
          color: #94A3B8 !important;
          font-family: var(--font-mono);
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .prose h2 {
          font-family: var(--font-sans);
          font-weight: 500;
          font-size: 24px !important;
          margin-top: 64px !important;
          margin-bottom: 24px !important;
          color: #E2E8F0 !important;
          border-bottom: 1px solid #1E293B;
          padding-bottom: 12px;
        }

        .prose p {
          font-family: var(--font-sans);
          font-size: 16px !important;
          line-height: 1.6 !important;
          color: #E2E8F0 !important;
          margin-top: 1.5rem !important;
          margin-bottom: 1.5rem !important;
          max-width: 72ch;
        }

        .prose strong { color: #ffffff !important; font-weight: 600; }
        
        .prose ul, .prose ol {
          margin-top: 1.5rem !important;
          margin-bottom: 1.5rem !important;
          padding-left: 1.5rem !important;
        }

        .prose li {
          margin-top: 0.75rem !important;
          margin-bottom: 0.75rem !important;
          color: #94A3B8 !important;
        }

        .prose a {
          color: #06B6D4 !important;
          text-decoration: none !important;
          border-bottom: 1px solid transparent;
          transition: border-color 0.2s;
        }
        .prose a:hover { border-color: #06B6D4; }

        .prose table {
          width: 100% !important;
          border-collapse: collapse !important;
          margin: 32px 0 !important;
          font-size: 13px !important;
          background: rgba(26, 31, 43, 0.4);
          border: 1px solid #1E293B;
        }
        .prose th {
          background: #1A1F2B !important;
          color: #94A3B8 !important;
          font-family: var(--font-mono);
          text-transform: uppercase;
          letter-spacing: 0.1em;
          padding: 12px 16px !important;
          text-align: left !important;
          border: 1px solid #1E293B !important;
        }
        .prose td {
          padding: 12px 16px !important;
          border: 1px solid #1E293B !important;
          color: #E2E8F0 !important;
        }
      `)}} />
    </div>
  );
}