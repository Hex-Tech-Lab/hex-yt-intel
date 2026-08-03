import { useEffect, useState } from 'react';

/**
 * Returns true if the viewport is below Tailwind's `xl` breakpoint (1280px).
 * Below `xl`, the dashboard renders as a single-column stacked layout where
 * tab switching is required to bring the console/video into view.
 */
export function useIsStackedLayout(): boolean {
  const [isStacked, setIsStacked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(max-width: 1279px)');
    const update = () => setIsStacked(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isStacked;
}
