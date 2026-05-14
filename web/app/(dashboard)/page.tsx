'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function DashboardPage() {
  const [url, setUrl] = useState('');
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFetch = async () => {
    if (!url) return;
    setLoading(true);
    try {
      const res = await fetch('/api/metadata', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setSynthesis(`Title: ${data.title}\nChannel: ${data.channelTitle}`);
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Unknown'));
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!url) {
      alert('Please paste a URL first');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error('Failed to analyze');
      const data = await res.json();
      setSynthesis(data.markdown || data.synthesis);
    } catch (error) {
      alert('Error: ' + (error instanceof Error ? error.message : 'Unknown'));
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!url) {
      alert('Search not ready yet (Phase 2)');
      return;
    }
    alert('Semantic search coming in Chunk 9');
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)] px-4 py-4 overflow-hidden">
      {/* LEFT PANEL: 70-75% width (cols 1-9) */}
      <div className="col-span-9 flex flex-col overflow-hidden">
        <Card className="flex-1 overflow-y-auto p-6 bg-gray-50 border border-gray-200">
          {synthesis ? (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
              {synthesis}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p className="text-center">
                Paste a YouTube URL and click &quot;Create Synthesis&quot; to see output here
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* RIGHT PANEL: 25-30% width (cols 10-12) */}
      <div className="col-span-3 flex flex-col gap-4">
        {/* URL Input */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Paste YouTube URL
          </label>
          <Input
            type="text"
            placeholder="https://youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full"
          />
        </div>

        {/* 3 Action Buttons (stack vertically) */}
        <Button
          onClick={handleFetch}
          disabled={loading || !url}
          variant="outline"
          className="w-full"
        >
          {loading ? 'Loading...' : 'Fetch Metadata'}
        </Button>

        <Button
          onClick={handleAnalyze}
          disabled={loading || !url}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
        >
          {loading ? 'Analyzing...' : 'Create Synthesis'}
        </Button>

        <Button
          onClick={handleSearch}
          disabled={loading || !url}
          variant="outline"
          className="w-full"
        >
          Semantic Search
        </Button>
      </div>
    </div>
  );
}
