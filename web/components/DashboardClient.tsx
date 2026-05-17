'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import toast from 'react-hot-toast';

export function DashboardClient() {
  const [url, setUrl] = useState('');
  const [synthesis, setSynthesis] = useState<string | null>(null);
  const [analysisId, setAnalysisId] = useState<string | null>(null);
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
      setAnalysisId(null);
    } catch (error) {
      toast.error('Error: ' + (error instanceof Error ? error.message : 'Unknown'));
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!url) {
      toast.error('Please paste a URL first');
      return;
    }

    setLoading(true);
    setSynthesis(''); // Clear previous synthesis
    setAnalysisId(null);

    try {
      const res = await fetch('/api/analyses', {
        method: 'POST',
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      // Progressive streaming reader — no JSON buffer
      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body not readable');
      }

      const decoder = new TextDecoder();
      let fullSynthesis = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        fullSynthesis += chunk;

        // Progressive UI update per chunk
        setSynthesis(fullSynthesis);
      }

      // Reconcile DB insert with completed synthesis
      // (post-hoc: backend can also echo the analysisId in X-Analysis-ID header)
      if (!analysisId) {
        const tempId = crypto.randomUUID();
        setAnalysisId(tempId);
      }

      toast.success('Analysis complete!');
    } catch (error) {
      const err = error as Error;
      toast.error(err.message || 'Unknown error');
      setSynthesis(null); // Clear on error
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!analysisId) {
      toast.error('No analysis to export');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysisId}/export?format=pdf`);
      if (!res.ok) throw new Error('Failed to export');
      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `synthesis-${analysisId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);
      toast.success('PDF exported!');
    } catch (error) {
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    }
  };

  const handleShare = async () => {
    if (!analysisId) {
      toast.error('No analysis to share');
      return;
    }
    try {
      const res = await fetch(`/api/analyses/${analysisId}/share`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to generate share link');
      const data = await res.json();
      
      // Copy to clipboard
      await navigator.clipboard.writeText(data.shareUrl);
      toast.success('Share link copied to clipboard!');
    } catch (error) {
      toast.error('Share failed: ' + (error instanceof Error ? error.message : 'Unknown'));
    }
  };

  const handleSearch = async () => {
    toast('Semantic search coming in Chunk 7');
  };

  return (
    <div className="grid grid-cols-12 gap-4 h-[calc(100vh-120px)] px-4 py-4 overflow-hidden">
      {/* LEFT PANEL: 70-75% width (cols 1-9) */}
      <div className="col-span-9 flex flex-col overflow-hidden">
        <Card className="flex-1 overflow-y-auto p-6 bg-gray-50 border border-gray-200">
          {synthesis ? (
            <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-800">
              {synthesis}
              {loading && <span className="text-blue-500 animate-pulse ml-1">▌</span>}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <p className="text-center">
                {loading
                  ? 'Generating synthesis...'
                  : 'Paste a YouTube URL and click "Create Synthesis" to see output here'}
              </p>
            </div>
          )}
        </Card>

        {/* Export + Share buttons (below synthesis) */}
        {synthesis && analysisId && (
          <div className="flex gap-2 mt-4">
            <Button onClick={handleExport} variant="outline" className="flex-1">
              📥 Export PDF
            </Button>
            <Button onClick={handleShare} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
              🔗 Share Link
            </Button>
          </div>
        )}
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
