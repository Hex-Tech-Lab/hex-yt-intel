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
  // Facade pattern: the real YouTube IFrame API (www-widgetapi.js,
  // player_embed_es6 base.js, www-player.css, iframe_api bootstrap) is a
  // meaningful chunk of network/JS weight. Don't pull any of it in until the
  // user has expressed real intent to watch — either clicking the facade's
  // play button, or clicking a transcript timestamp (which implies "play
  // from here").
  const [interacted, setInteracted] = useState(false);

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
    if (!mounted || !interacted || !videoId || !containerRef.current) return;
    
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
    playerRef.current = adapter;
    
    // Timeout fallback: if onReady never fires, log and don't hang forever
    const readyTimeout = setTimeout(() => {
      if (cancelled) return;
      console.warn('[VideoPlayerCard] Player ready timeout - API may have failed to initialize', { videoId });
      adapter.destroy();
      if (playerRef.current === adapter) {
        playerRef.current = null;
      }
      setPlaybackError({ code: null, message: 'YouTube player failed to initialize' });
    }, 30000);
    
    adapter.mount(containerRef.current, videoId, {
      onReady: () => {
        clearTimeout(readyTimeout);
        if (cancelled || videoIdRef.current !== videoId) {
          adapter.destroy();
          if (playerRef.current === adapter) playerRef.current = null;
          return;
        }
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
      adapter.destroy();
      if (playerRef.current === adapter) {
        playerRef.current = null;
      }
      videoIdRef.current = null;
      setReady(false);
      setPlaybackError(null);
    };
  }, [mounted, interacted, videoId, setPlaying, retryNonce]);

  const embedRestricted = playbackError?.code === 101 || playbackError?.code === 150;

  // Embedding is permanently disabled for this video — the iframe YouTube
  // mounted is dead weight at this point: it keeps rendering its own
  // "Video unavailable" chrome and pulling its full asset set (kevlar/lottie
  // bundles, monitoring beacons) underneath our overlay indefinitely.
  // Destroying it stops that traffic and the CSS-hidden container is emptied
  // for real instead of just being visually covered.
  useEffect(() => {
    if (!embedRestricted) return;
    playerRef.current?.destroy();
    playerRef.current = null;
    setReady(false);
    if (containerRef.current) containerRef.current.innerHTML = '';
  }, [embedRestricted]);

  useEffect(() => {
    if (seekTo === null) return;
    // A transcript timestamp click while still on the facade expresses the
    // same "play this video" intent as clicking the play button — mount the
    // real player so the queued seek can land once it's ready.
    if (!interacted && !embedRestricted) {
      setInteracted(true);
    }
    if (ready && playerRef.current) {
      playerRef.current.seekTo(seekTo);
      // Not calling play() here: setSeekTo already flips isPlaying true in
      // the store, and the isPlaying effect below (the single authority for
      // "should the iframe be playing") will fire and call play() itself --
      // calling it here too would be a second code path doing the same job.
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
  }, [seekTo, ready, clearSeek, embedRestricted, interacted]);

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
        {/* Solid backing so the destroyed-but-briefly-still-painting YouTube
            iframe (and its own "Video unavailable" chrome) can never show
            through the thumbnail's 30% opacity during the render gap. */}
        <div className="absolute inset-0 bg-[rgb(11_14_20_/_0.85)]" />
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
      {interacted && !ready && !embedRestricted && !playbackError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[rgb(11_14_20_/_0.85)] backdrop-blur-sm pointer-events-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover opacity-20"
          />
          <div className="relative flex flex-col items-center gap-2">
            <span className="flex items-center justify-center w-12 h-12 rounded-full bg-[var(--surface)] border border-[var(--accent)] text-[var(--accent)] animate-pulse">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 animate-spin">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
            </span>
            <span className="font-mono text-xs text-[var(--accent)] font-semibold animate-pulse">
              Initializing YouTube Player…
            </span>
          </div>
        </div>
      )}
      {!interacted && !embedRestricted && (
        <button
          type="button"
          onClick={() => setInteracted(true)}
          aria-label="Play video"
          className="absolute inset-0 z-10 w-full h-full group cursor-pointer"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- external YouTube thumbnail, next/image needs remote host config */}
          <img
            src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-[rgb(11_14_20_/_0.35)] group-hover:bg-[rgb(11_14_20_/_0.5)] transition-colors flex items-center justify-center">
            <span className="flex items-center justify-center w-16 h-16 rounded-full bg-[rgb(11_14_20_/_0.75)] border border-[var(--accent)] text-[var(--accent)] group-hover:scale-105 transition-transform">
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-7 h-7 translate-x-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </div>
        </button>
      )}
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
      <div ref={containerRef} className={`w-full h-full ${embedRestricted ? 'hidden' : ''}`} style={embedRestricted ? { display: 'none' } : undefined} />
    </div>
  );
}
