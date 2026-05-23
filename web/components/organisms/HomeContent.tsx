'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect } from 'react';
import { Play, Download, RotateCcw, Clock } from 'lucide-react';
import RateLimitAlert from '@/components/RateLimitAlert';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSSEStream } from '@/hooks/useSSEStream';
import { useAuth } from '@/hooks/useAuth';

const STORAGE_KEY = 'hex_intel_saved_input';

interface CachedAnalysisDialog {
  show: boolean;
  title: string;
  createdAt: string;
  videoId: string;
  analysisId: string;
}

export default function HomeContent() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  const [url, setUrl] = useState('');
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      setUrl(cached);
    }
  }, []);

  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = e.target.value;
    setUrl(newUrl);
    localStorage.setItem(STORAGE_KEY, newUrl);
  };

  const isDevelopment = process.env.NODE_ENV === 'development';
  const [devMode, setDevMode] = useState(isDevelopment);
  const [cachedDialog, setCachedDialog] = useState<CachedAnalysisDialog>({
    show: false,
    title: '',
    createdAt: '',
    videoId: '',
    analysisId: '',
  });
  const { startAnalysis } = useSSEStream();
  const { clearAnalysis, analysis, isLoading, lockoutTimeRemaining } = useAnalysisStore();

  // Get user's local timezone for analysis request
  const getUserTimezone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo';
    } catch (err) {
      const error = err as Error;
      console.warn('Failed to get timezone:', error.message);
      return 'Africa/Cairo';
    }
  };

  const handleDevLogin = async () => {
    // This now simply shows the dev mode state as we don't mock sessions for now
    setDevMode(false);
  };

  const checkCachedAnalysis = async (videoUrl: string) => {
    try {
      const urlObj = new URL(videoUrl);
      const videoId = urlObj.searchParams.get('v') || videoUrl.split('/').pop();

      if (!videoId) {
        return null;
      }

      const response = await fetch(`/api/analyses/check?videoId=${encodeURIComponent(videoId)}`, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (data.exists && data.cached) {
        return {
          title: data.title || 'Analysis',
          createdAt: data.createdAt ? new Date(data.createdAt).toLocaleString() : 'unknown',
          videoId: data.videoId || videoId,
          analysisId: data.analysisId,
        };
      }
      return null;
    } catch (error) {
      console.error('Cache check failed:', error);
      return null;
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (!user && !devMode) {
      router.push('/auth/signin');
      return;
    }

    // Pre-flight check: Look for cached analysis
    const cached = await checkCachedAnalysis(url);
    if (cached) {
      setCachedDialog({
        show: true,
        title: cached.title,
        createdAt: cached.createdAt,
        videoId: cached.videoId,
        analysisId: cached.analysisId,
      });
      return;
    }

    await startAnalysis(url, getUserTimezone());
  };

  const handleUseCached = () => {
    // Load cached analysis from store or navigate to view
    setCachedDialog({ ...cachedDialog, show: false });
    router.push(`/analyses/saved?id=${cachedDialog.analysisId}`);
  };

  const handleForceRefresh = () => {
    setCachedDialog({ ...cachedDialog, show: false });
    startAnalysis(url, getUserTimezone());
  };

  const handleClear = () => {
    clearAnalysis();
    setUrl('');
  };

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  const handleExport = () => {
    if (!analysis) return;
    const element = document.createElement('a');
    const blob = new Blob([analysis.analysis_markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    element.setAttribute('href', url);
    element.setAttribute('download', `${analysis.title}.md`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Hex-YT-Intel</h1>
          <nav className="flex gap-4">
            {isDevelopment && (
              <button
                onClick={handleDevLogin}
                disabled={!devMode}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                Dev Login
              </button>
            )}
            <Link href="/search" className="px-4 py-2 text-gray-700 hover:text-black text-sm">
              Search
            </Link>
            <Link href="/analyses/saved" className="px-4 py-2 text-gray-700 hover:text-black text-sm">
              Saved
            </Link>
            <Link href="/pricing" className="px-4 py-2 text-gray-700 hover:text-black text-sm">
              Pricing
            </Link>
            <Link href="/billing" className="px-4 py-2 text-gray-700 hover:text-black text-sm">
              Billing
            </Link>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 text-gray-700 hover:text-black text-sm"
            >
              Sign Out
            </button>
            {!user && (
              <Link href="/auth/signin" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
                Sign In
              </Link>
            )}
          </nav>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto bg-gray-50 border-r border-gray-200 p-8">
          {analysis ? (
            <div className="max-w-4xl">
              <h2 className="text-3xl font-bold mb-6">{analysis.title}</h2>
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-gray-800 font-mono text-sm leading-relaxed">
                  {analysis.analysis_markdown}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-gray-400 text-lg">Paste a YouTube URL and click Analyze to see results</p>
                <p className="text-gray-400 text-sm mt-2">Example: https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>
              </div>
            </div>
          )}
        </div>

        <div className="w-[30%] bg-white border-l border-gray-200 p-6 flex flex-col overflow-auto">
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">YouTube URL</label>
            <form onSubmit={handleAnalyze} className="space-y-3">
              <input
                type="text"
                placeholder="Paste YouTube URL..."
                value={isMounted ? url : ''}
                onChange={handleUrlChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />

              {lockoutTimeRemaining > 0 && (
                <RateLimitAlert
                  secondsRemaining={lockoutTimeRemaining}
                />
              )}

              <div className="grid grid-cols-1 gap-2">
                <button
                  type="submit"
                  disabled={isLoading || !url.trim() || lockoutTimeRemaining > 0}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
                >
                  {lockoutTimeRemaining > 0 ? (
                    <>
                      <Clock className="w-4 h-4" /> Rate Limited ({lockoutTimeRemaining}s)
                    </>
                  ) : isLoading ? (
                    <>
                      <span className="animate-spin">⟳</span> Analyzing...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> Analyze
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleExport}
                  disabled={!analysis}
                  className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" /> Export
                </button>

                <button
                  type="button"
                  onClick={handleClear}
                  disabled={!analysis}
                  className="w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" /> Clear
                </button>
              </div>

              {!user && devMode && isDevelopment && (
                <p className="text-xs text-gray-500 pt-2">
                  Click &quot;Dev Login&quot; above to test the UI
                </p>
              )}
            </form>

            {cachedDialog.show && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                <div className="bg-white rounded-lg shadow-lg p-6 max-w-md">
                  <h3 className="text-lg font-semibold mb-2">Analysis Already Exists</h3>
                  <p className="text-sm text-gray-600 mb-4">
                    We found a cached analysis for this video:
                  </p>
                  <div className="bg-gray-50 p-3 rounded mb-4 text-sm">
                    <p className="font-medium">{cachedDialog.title}</p>
                    <p className="text-gray-500 text-xs mt-1">Analyzed: {cachedDialog.createdAt}</p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleUseCached}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                    >
                      View Cached
                    </button>
                    <button
                      onClick={handleForceRefresh}
                      className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded hover:bg-gray-50 text-sm font-medium"
                    >
                      Re-analyze
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Pricing</h3>
            <div className="space-y-2 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Free tier:</span>
                <span className="font-medium">3 analyses/month</span>
              </div>
              <div className="flex justify-between">
                <span>Pro ($9/mo):</span>
                <span className="font-medium">Unlimited</span>
              </div>
              <Link
                href="/pricing"
                className="block mt-3 px-3 py-2 bg-blue-50 text-blue-600 rounded text-center hover:bg-blue-100 text-xs font-medium"
              >
                View Full Pricing
              </Link>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Features</h3>
            <ul className="space-y-2 text-xs text-gray-600">
              <li>✓ Ultimate Content Intelligence v3.2</li>
              <li>✓ Semantic search (Pro)</li>
              <li>✓ Export as Markdown</li>
              <li>✓ Secure & private</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
