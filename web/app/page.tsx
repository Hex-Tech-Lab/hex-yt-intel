'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Play, Search, TrendingUp, Lock } from 'lucide-react';

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    if (!session) {
      router.push('/auth/signin');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (response.ok) {
        const data = await response.json();
        router.push(`/analyses/${data.id}`);
      } else {
        alert('Failed to analyze video');
      }
    } catch (error) {
      alert('Error analyzing video');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Navigation */}
      <nav className="fixed top-0 w-full bg-white border-b border-gray-200 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold">Hex-YT-Intel</div>
          <div className="flex gap-4">
            {session ? (
              <>
                <Link href="/search" className="px-4 py-2 text-gray-700 hover:text-black">
                  Search
                </Link>
                <Link href="/analyses/saved" className="px-4 py-2 text-gray-700 hover:text-black">
                  Saved
                </Link>
                <Link href="/pricing" className="px-4 py-2 text-gray-700 hover:text-black">
                  Pricing
                </Link>
              </>
            ) : (
              <Link
                href="/auth/signin"
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="pt-24">
        <section className="bg-gradient-to-b from-blue-50 to-white py-20">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <h1 className="text-5xl font-bold mb-4">YouTube Intelligence</h1>
            <p className="text-xl text-gray-600 mb-12">
              Deep analysis of any YouTube video using AI-powered synthesis
            </p>

            {/* Search Form */}
            <form onSubmit={handleAnalyze} className="max-w-2xl mx-auto mb-12">
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="Paste YouTube URL..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  required
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <span className="animate-spin">⟳</span> Analyzing...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> Analyze
                    </>
                  )}
                </button>
              </div>
              {!session && (
                <p className="text-sm text-gray-500 mt-3">
                  Sign in to analyze videos →
                </p>
              )}
            </form>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-8 mt-16">
              <div className="p-6 bg-white rounded-lg border border-gray-200">
                <div className="flex justify-center mb-4">
                  <Search className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Semantic Search</h3>
                <p className="text-gray-600">
                  Search across all your analyzed videos using natural language
                </p>
              </div>

              <div className="p-6 bg-white rounded-lg border border-gray-200">
                <div className="flex justify-center mb-4">
                  <TrendingUp className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Intelligence</h3>
                <p className="text-gray-600">
                  Ultimate Content Intelligence v3.2 framework analysis
                </p>
              </div>

              <div className="p-6 bg-white rounded-lg border border-gray-200">
                <div className="flex justify-center mb-4">
                  <Lock className="w-8 h-8 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold mb-2">Secure</h3>
                <p className="text-gray-600">
                  Your data is private and secure with end-to-end encryption
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing CTA */}
        <section className="bg-white py-16 border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-6 text-center">
            <h2 className="text-3xl font-bold mb-4">Pricing Plans</h2>
            <p className="text-gray-600 mb-8">
              Free tier includes 3 analyses/month. Upgrade for unlimited access.
            </p>
            <Link
              href="/pricing"
              className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              View Pricing
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
