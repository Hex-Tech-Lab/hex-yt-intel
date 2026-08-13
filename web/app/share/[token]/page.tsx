import { SupabasePersistenceAdapter } from '@/lib/adapters/SupabasePersistenceAdapter';
import { SupabaseSettingsAdapter } from '@/lib/adapters/SupabaseSettingsAdapter';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { MarkdownRenderer } from './MarkdownRenderer';
import { PublicHighlightsReel } from './PublicHighlightsReel';

export const dynamic = 'force-dynamic';

const HIGHLIGHTS_REGISTRY_FALLBACK = {
  'highlights.segmentDurationSeconds': 10,
  'highlights.contextLeadSeconds': 2.5,
} as const;

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

  // Highlights are optional -- older shared analyses (pre task #7/#14) or
  // ones where extraction failed simply have zero rows; fail quiet, same
  // as the authenticated HighlightsScrubber does.
  const [highlights, registrySettings] = await Promise.all([
    adapter.findHighlightsForAnalysis(analysis.id),
    SupabaseSettingsAdapter.getRegistrySettings(Object.keys(HIGHLIGHTS_REGISTRY_FALLBACK), HIGHLIGHTS_REGISTRY_FALLBACK),
  ]);

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

      {/* Highlights reel (Read-Only, no sign-in) */}
      {analysis.videoId && highlights.length > 0 && (
        <div className="px-6 pt-8 max-w-4xl mx-auto">
          <PublicHighlightsReel
            videoId={analysis.videoId}
            highlights={highlights}
            segmentDurationSeconds={Number(registrySettings['highlights.segmentDurationSeconds'])}
            contextLeadSeconds={Number(registrySettings['highlights.contextLeadSeconds'])}
            videoDurationSeconds={analysis.videoDurationSeconds}
          />
        </div>
      )}

      {/* Content (Read-Only) */}
      <div className="px-6 py-12 max-w-4xl mx-auto">
        <div className="prose prose-blue max-w-none">
          <MarkdownRenderer content={analysis.analysisMarkdown || ''} />
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
