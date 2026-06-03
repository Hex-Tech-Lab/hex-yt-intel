/**
 * HTTP Utilities for Worker
 *
 * Proxy-aware fetch wrapper with Cloudflare Workers extensions
 */

export async function fetchWithProxy(
  targetUrl: string,
  init: RequestInit = {},
  proxyUrl?: string
): Promise<Response> {
  if (!proxyUrl) return fetch(targetUrl, init);

  const atIndex = proxyUrl.lastIndexOf('@');
  if (atIndex === -1) return fetch(targetUrl, init);

  const credentials = proxyUrl.slice(0, atIndex);
  const hostPort = proxyUrl.slice(atIndex + 1);

  return fetch(targetUrl, {
    ...init,
    headers: {
      ...(typeof init.headers === 'object' && init.headers !== null
        ? (init.headers as Record<string, string>)
        : {}),
      'Proxy-Authorization': `Basic ${btoa(credentials)}`,
    },
    // @ts-ignore – Cloudflare Workers proxy extension
    proxy: `http://${hostPort}`,
  });
}
