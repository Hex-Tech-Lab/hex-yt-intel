import { useEffect, useState } from 'react';

export const STACKED_LAYOUT_QUERY = '(max-width: 1279px)';

/**
 * Synchronous, non-reactive check for whether the viewport is below
 * Tailwind's `xl` breakpoint (1280px) right now. Safe to call inside an
 * event handler or effect that needs the current layout mode at a single
 * point in time — unlike `useIsStackedLayout`, it does not subscribe to
 * changes and will not trigger a re-render on breakpoint crossings.
 */
export function isStackedLayout(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(STACKED_LAYOUT_QUERY).matches;
}

/**
 * Returns true if the viewport is below Tailwind's `xl` breakpoint (1280px).
 * Below `xl`, the dashboard renders as a single-column stacked layout where
 * tab switching is required to bring the console/video into view.
 */
export function useIsStackedLayout(): boolean {
  const [isStacked, setIsStacked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(STACKED_LAYOUT_QUERY);
    const update = () => setIsStacked(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isStacked;
}
