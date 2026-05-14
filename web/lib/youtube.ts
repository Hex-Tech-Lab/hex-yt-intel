export function extractVideoId(url: string): string | null {
  try {
    const urlObj = new URL(url);

    // youtube.com/watch?v=ID
    if (urlObj.hostname.includes('youtube.com')) {
      const id = urlObj.searchParams.get('v');
      if (id) return id;
    }

    // youtu.be/ID
    if (urlObj.hostname.includes('youtu.be')) {
      const id = urlObj.pathname.slice(1);
      if (id) return id;
    }

    // youtube.com/embed/ID
    if (urlObj.pathname.startsWith('/embed/')) {
      const id = urlObj.pathname.split('/')[2];
      if (id) return id;
    }

    // youtube.com/v/ID
    if (urlObj.pathname.startsWith('/v/')) {
      const id = urlObj.pathname.split('/')[2];
      if (id) return id;
    }
  } catch {
    return null;
  }

  return null;
}
