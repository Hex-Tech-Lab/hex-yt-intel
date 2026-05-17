'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Play, Download, RotateCcw, Clock } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { apiCall } from '@/lib/api-client';
import RateLimitAlert from '@/components/RateLimitAlert';

export default function Home() {
  // Defensive null-safe session guard: gracefully handle unauthenticated visitors
  const { data: session, update: updateSession } = useSession() ?? { data: null };
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [analysis, setAnalysis] = useState<{ id: string; title: string; markdown: string } | null>(null);
  const [devMode, setDevMode] = useState(true); // Allow testing without auth
  const [lockoutTimeRemaining, setLockoutTimeRemaining] = useState(0);

  // Countdown timer for rate-limit lockout
  useEffect(() => {
    if (lockoutTimeRemaining <= 0) return;

    const interval = setInterval(() => {
      setLockoutTimeRemaining((prev) => {
        const newValue = prev - 1;
        if (newValue <= 0) {
          clearInterval(interval);
          return 0;
        }
        return newValue;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [lockoutTimeRemaining]);

  const handleDevLogin = async () => {
    // Mock session for development testing
    await updateSession({
      user: {
        id: 'dev-user-123',
        email: 'dev@example.com',
        name: 'Test User',
        image: null,
      },
    });
    setDevMode(false);
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (!session && !devMode) {
      router.push('/auth/signin');
      return;
    }

    setIsLoading(true);
    try {
      const result = await apiCall('/api/analyses', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() }),
      });

      if (result.ok && result.data) {
        const data = result.data as { id: string; title?: string; markdown?: string };
        setAnalysis({
          id: data.id,
          title: data.title || 'Analysis',
          markdown: data.markdown || 'Analysis in progress...',
        });
      } else if (result.rateLimitError) {
        // Handle rate limit: activate countdown and disable button
        setLockoutTimeRemaining(result.rateLimitError.retryAfter);
        console.warn('Rate limited:', result.rateLimitError.message);
      } else {
        const errorMsg = result.error || `HTTP ${result.status}`;
        console.error('Analysis failed:', errorMsg);
        alert(`Failed to analyze video: ${errorMsg}`);
      }
    } catch (error) {
      console.error('Error analyzing video:', error);
      alert('Error analyzing video');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClear = () => {
    setAnalysis(null);
    setUrl('');
  };

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/');
  };

  const handleExport = () => {
    if (!analysis) return;
    const element = document.createElement('a');
    element.setAttribute('href', `data:text/markdown;charset=utf-8,${encodeURIComponent(analysis.markdown)}`);
    element.setAttribute('download', `${analysis.title}.md`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="px-6 py-4 flex justify-between items-center">
          <h1 className="text-2xl font-bold">Hex-YT-Intel</h1>
          <nav className="flex gap-4">
            <button
              onClick={handleDevLogin}
              disabled={!devMode}
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            >
              Dev Login
            </button>
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
            {!session && (
              <Link href="/auth/signin" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
                Sign In
              </Link>
            )}
          </nav>
        </div>
      </header>

      {/* Main Layout: 70% left (output) + 30% right (input) */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left Panel: Output (70-75%) */}
        <div className="flex-1 overflow-auto bg-gray-50 border-r border-gray-200 p-8">
          {analysis ? (
            <div className="max-w-4xl">
              <h2 className="text-3xl font-bold mb-6">{analysis.title}</h2>
              <div className="prose prose-sm max-w-none">
                <div className="whitespace-pre-wrap text-gray-800 font-mono text-sm leading-relaxed">
                  {analysis.markdown}
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

        {/* Right Panel: Input & Controls (25-30%) */}
        <div className="w-[30%] bg-white border-l border-gray-200 p-6 flex flex-col overflow-auto">

          {/* Input Section */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">YouTube URL</label>
            <form onSubmit={handleAnalyze} className="space-y-3">
              <input
                type="url"
                placeholder="Paste YouTube URL..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 text-sm"
                required
              />

              {/* Rate Limit Alert */}
              {lockoutTimeRemaining > 0 && (
                <RateLimitAlert
                  secondsRemaining={lockoutTimeRemaining}
                />
              )}

              {/* 3 Action Buttons */}
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

              {!session && devMode && (
                <p className="text-xs text-gray-500 pt-2">
                  Click &quot;Dev Login&quot; above to test the UI
                </p>
              )}
            </form>
          </div>

          {/* Pricing Info */}
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

          {/* Features */}
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
