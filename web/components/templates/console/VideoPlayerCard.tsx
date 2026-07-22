'use client';

import { useEffect, useRef, useState } from 'react';
import { useVideoStore } from '@/store/useVideoStore';
import { useAnalysisStore } from '@/store/useAnalysisStore';
import { useSynthesisNucleus } from '@/lib/stores/synthesis-nucleus-store';
import { YouTubePlayerAdapter } from '@/lib/adapters/YouTubePlayerAdapter';
import type { VideoPlayerPort } from '@/lib/ports/VideoPlayerPort';

export function VideoPlayerCard() {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<VideoPlayerPort | null>(null);
  const seekQueueRef = useRef<number | null>(null);
  const videoIdRef = useRef<string | null>(null);
  const isPlayingRef = useRef(false);
  const { isPlaying, seekTo, clearSeek, setPlaying } = useVideoStore();
  const videoMetadata = useAnalysisStore((s) => s.videoMetadata);
  const nucleusVideoId = useSynthesisNucleus((s) => s.analysis?.videoId);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);

  const [playbackError, setPlaybackError] = useState<{ code: number | null; message: string } | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  // Last timestamp clicked while the embedded player is unavailable — keeps
  // transcript timestamps functional by feeding the fallback "Play on
  // YouTube" action instead of a dead iframe seek.
  const [fallbackSeek, setFallbackSeek] = useState<number | null>(null);

  const videoId = videoMetadata?.videoId || nucleusVideoId;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !videoId || !containerRef.current) return;
    
    let cancelled = false;
    
    if (playerRef.current) {
      playerRef.current.destroy();
      playerRef.current = null;
    }
    setReady(false);
    setPlaybackError(null);
    setFallbackSeek(null);
    videoIdRef.current = videoId;

    const adapter = new YouTubePlayerAdapter();
    
    // Timeout fallback: if onReady never fires, log and don't hang forever
    const readyTimeout = setTimeout(() => {
      if (!cancelled && !playerRef.current) {
        console.warn('[VideoPlayerCard] Player ready timeout - API may have failed to initialize', { videoId });
      }
    }, 15000);
    
    adapter.mount(containerRef.current, videoId, {
      onReady: () => {
        if (cancelled || videoIdRef.current !== videoId) {
          adapter.destroy();
          return;
        }
        playerRef.current = adapter;
        setReady(true);
        if (seekQueueRef.current !== null) {
          adapter.seekTo(seekQueueRef.current);
          seekQueueRef.current = null;
        }
        if (isPlayingRef.current) adapter.play();
      },
      onError: (err) => {
        if (cancelled) return;
        console.error('[VideoPlayerCard]', { message: err.message, videoId });
        const parsedCode = /YouTube error: (\d+)/.exec(err.message)?.[1];
        const code = parsedCode ? Number(parsedCode) : null;
        setPlaybackError({ code, message: err.message });
      },
      onPlay: () => {
        if (!cancelled) setPlaying(true);
      },
      onPause: () => {
        if (!cancelled) setPlaying(false);
      },
    });

    return () => {
      cancelled = true;
      clearTimeout(readyTimeout);
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      videoIdRef.current = null;
      setReady(false);
      setPlaybackError(null);
    };
  }, [mounted, videoId, setPlaying, retryNonce]);

  const embedRestricted = playbackError?.code === 101 || playbackError?.code === 150;

  useEffect(() => {
    if (seekTo === null) return;
    if (ready && playerRef.current) {
      playerRef.current.seekTo(seekTo);
      requestAnimationFrame(() => {
        clearSeek();
      });
    } else if (embedRestricted) {
      // Player can never come up for this video — route the timestamp to the
      // fallback card so the click still does something meaningful.
      setFallbackSeek(seekTo);
      requestAnimationFrame(() => {
        clearSeek();
      });
    } else {
      seekQueueRef.current = seekTo;
    }
  }, [seekTo, ready, clearSeek, embedRestricted]);

  useEffect(() => {
    if (!ready || !playerRef.current) return;
    if (isPlaying) {
      playerRef.current.play();
    } else {
      playerRef.current.pause();
    }
  }, [isPlaying, ready]);

  if (!mounted || !videoId) return null;

  // 101/150 = embedding disabled by the owner — the embedded player can never
  // recover, so swap in a thumbnail-backed fallback player that keeps
  // timestamps functional. Every other error (transient "Playback ID" faults,
  // network hiccups, HTML5 errors) keeps the player mounted so YouTube's own
  // UI stays visible and the user can retry.
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}${
    fallbackSeek !== null ? `&t=${Math.floor(fallbackSeek)}s` : ''
  }`;
  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  // RCA (2026-07-22): this used to conditionally render the two overlay
  // branches with JSX ternaries (embedRestricted ? <A/> : playbackError ?
  // <B/> : null), which adds/removes real sibling DOM nodes around
  // `containerRef` whenever the error state toggles. That div's contents are
  // owned by the YouTube IFrame API once mounted (it replaces them with a
  // real <iframe>, invisible to React's virtual DOM) -- so the moment a
  // playback error fires and React tries to insert/remove a sibling overlay
  // node using that div as an anchor, the DOM no longer matches what React's
  // reconciler expects, throwing "Failed to execute 'insertBefore' ...: not
  // a child of this node" (observed live: YouTube error 150 -> immediate
  // NotFoundError crash). Both overlay slots are now ALWAYS rendered with a
  // stable DOM node count/order; only CSS visibility toggles, so React never
  // needs to insert/remove nodes around the third-party-mutated container.
  return (
    <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-[var(--line)] shadow-lg">
      <div className={`absolute inset-0 z-10 flex-col items-center justify-center p-6 text-center text-xs font-mono ${embedRestricted ? 'flex' : 'hidden'}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail, next/image needs remote host config */}
        <img
          src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover opacity-30"
        />
        <div className="relative flex flex-col items-center">
          <div className="text-[var(--warn)] font-bold mb-2 uppercase tracking-wider">Embedding Restricted By Creator</div>
          <p className="text-[var(--ink-muted)] max-w-sm mb-4 leading-relaxed">
            In-app playback is blocked by this video&apos;s embed policy. Timestamps in the analysis still work — clicking one updates the button below.
          </p>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 rounded-lg border border-[var(--accent)] text-[var(--accent)] font-bold hover:bg-[rgb(26_31_43_/_0.8)] transition-colors"
          >
            ▶ {fallbackSeek !== null ? `Play from ${formatTime(fallbackSeek)}` : 'Play'} on YouTube ↗
          </a>
        </div>
      </div>
      <div className={`absolute inset-x-0 bottom-0 z-10 items-center justify-between gap-3 px-3 py-2 bg-[rgb(11_14_20_/_0.92)] backdrop-blur-sm border-t border-[var(--line)] text-[11px] font-mono ${!embedRestricted && playbackError ? 'flex' : 'hidden'}`}>
        <span className="text-[var(--warn)] truncate">Playback error — this is usually transient.</span>
        <span className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => {
              setPlaybackError(null);
              setRetryNonce((n) => n + 1);
            }}
            className="px-2.5 py-1 rounded-md border border-[var(--line)] text-[var(--accent)] cursor-pointer hover:bg-[rgb(26_31_43_/_0.6)] transition-colors"
          >
            Retry
          </button>
          <a
            href={watchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1 rounded-md border border-[var(--line)] text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
          >
            YouTube ↗
          </a>
        </span>
      </div>
      <div ref={containerRef} className={`w-full h-full ${embedRestricted ? 'hidden' : ''}`} />
    </div>
  );
}
