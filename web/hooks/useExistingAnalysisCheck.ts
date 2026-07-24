import { useEffect, useRef, useState } from 'react';
import { extractVideoId } from '@/lib/youtube';

// UI micro-interaction timing (matches AnalysisHistory's search debounce),
// not a settings-registry tunable -- avoids firing a check on every keystroke
// while typing/pasting a URL.
const CHECK_DEBOUNCE_MS = 300;

/**
 * Debounced "has this video already been analyzed by this user?" check,
 * driving the Analyze/Re-analyze button label decision *before* the user
 * clicks anything -- not just after a run completes. Per the user's own
 * framing: "if it was there before and analyzed then the button should
 * change... whether in the url input box or from history."
 *
 * Reuses the existing GET /api/analyses/check pre-flight endpoint (built for
 * polling in-progress analyses) rather than a new one -- it already answers
 * exactly this question (`exists: true` when billing_status='completed').
 */
export function useExistingAnalysisCheck(url: string): boolean {
  const [hasExisting, setHasExisting] = useState(false);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const videoId = url ? extractVideoId(url) : '';
    if (!videoId) {
      setHasExisting(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/analyses/check?videoId=${encodeURIComponent(videoId)}`, { credentials: 'include' });
          if (!res.ok || requestIdRef.current !== requestId) return;
          const data = await res.json();
          if (requestIdRef.current !== requestId) return;
          setHasExisting(data?.exists === true && data?.status === 'complete');
        } catch {
          if (requestIdRef.current === requestId) setHasExisting(false);
        }
      })();
    }, CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [url]);

  return hasExisting;
}
