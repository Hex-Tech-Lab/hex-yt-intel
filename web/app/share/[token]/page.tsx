export const dynamic = 'force-dynamic';

import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const markdownProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeStringify);

export default async function SharePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;

  // Fetch analysis by share token via Persistence Adapter (no auth required for public links)
  const adapter = new SupabasePersistenceAdapter();
  const analysis = await adapter.findAnalysisByShareToken(token);

  if (!analysis) {
    notFound();
  }

  // Check expiry
  if (analysis.sharedExpiresAt) {
    const expiryDate = new Date(analysis.sharedExpiresAt);
    if (expiryDate < new Date()) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
          <div className="bg-surface p-8 rounded-lg shadow max-w-md text-center">
            <h1 className="text-2xl font-bold text-gray-900">Link Expired</h1>
            <p className="text-gray-600 mt-2">This shared link has expired.</p>
            <Link href="/" className="mt-6 inline-block text-blue-600 hover:underline">Go to Hex-YT-Intel</Link>
          </div>
        </div>
      );
    }
  }

  // Server-side: process markdown -> safe HTML (XSS-safe via rehype-sanitize)
  const file = await markdownProcessor.process(analysis.analysisMarkdown || '');
  const htmlContent = String(file);

  return (
    <div className="bg-surface min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">{analysis.title}</h1>
          <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600">
            <span>Channel: <span className="font-medium">{analysis.channelTitle}</span></span>
            <span>•</span>
            <span>Generated: {new Date(analysis.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Content (Read-Only) */}
      <div className="px-6 py-12 max-w-4xl mx-auto">
        <div className="prose prose-blue max-w-none">
          <div
            className="whitespace-pre-wrap text-gray-800 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: htmlContent }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-gray-100 bg-gray-50 px-6 py-12 text-center text-sm text-gray-500">
        <div className="max-w-4xl mx-auto">
          <p className="font-semibold text-gray-700 mb-1">Hex-YT-Intel</p>
          <p>This is a read-only shared synthesis of a YouTube video.</p>
          <div className="mt-4">
            <Link href="/" className="text-blue-600 hover:text-blue-800 font-medium">
              Analyze your own videos →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
