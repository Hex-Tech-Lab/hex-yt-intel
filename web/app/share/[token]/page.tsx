import { getSupabaseClient } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function SharePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;

  // Fetch analysis by share token (no auth required)
  const supabase = getSupabaseClient();
  const { data: analysis, error } = await supabase
    .from('analyses')
    .select('*')
    .eq('shared_token', token)
    .maybeSingle();

  if (error || !analysis) {
    notFound();
  }

  // Check expiry
  if (analysis.shared_expires_at) {
    const expiryDate = new Date(analysis.shared_expires_at);
    if (expiryDate < new Date()) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-gray-100">
          <div className="bg-white p-8 rounded-lg shadow max-w-md text-center">
            <h1 className="text-2xl font-bold text-gray-900">Link Expired</h1>
            <p className="text-gray-600 mt-2">This shared link has expired.</p>
            <Link href="/" className="mt-6 inline-block text-blue-600 hover:underline">Go to Hex-YT-Intel</Link>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-8">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900">{analysis.title}</h1>
          <div className="flex flex-wrap gap-4 mt-4 text-sm text-gray-600">
            <span>Channel: <span className="font-medium">{analysis.channel_title}</span></span>
            <span>•</span>
            <span>Generated: {new Date(analysis.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* Content (Read-Only) */}
      <div className="px-6 py-12 max-w-4xl mx-auto">
        <div className="prose prose-blue max-w-none">
          <div
            className="whitespace-pre-wrap text-gray-800 leading-relaxed"
            dangerouslySetInnerHTML={{
              __html: (analysis.analysis_markdown || '')
                .split('\n')
                .map((line: string) => {
                  if (line.startsWith('### ')) {
                    return `<h3 class="text-xl font-bold mt-8 mb-4">${line.replace(/^### /, '')}</h3>`;
                  }
                  if (line.startsWith('## ')) {
                    return `<h2 class="text-2xl font-bold mt-10 mb-6 border-b pb-2">${line.replace(/^## /, '')}</h2>`;
                  }
                  if (line.startsWith('# ')) {
                    return `<h1 class="text-3xl font-bold mt-12 mb-8">${line.replace(/^# /, '')}</h1>`;
                  }
                  if (line.trim() === '') {
                    return '<div class="h-4"></div>';
                  }
                  return `<p class="mb-4">${line}</p>`;
                })
                .join(''),
            }}
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
