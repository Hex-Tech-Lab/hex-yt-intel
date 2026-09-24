// ADR 032 wave 2a spike S3 — throwaway measurement worker (not product code).
// Mirrors ADR 032 §2.1 "Stream" row: fetch upstream raw bytes, tee() body,
// branch 1 streams back unchanged, branch 2 collected as raw Uint8Array chunks
// (no decode, no parse); in waitUntil: concat → SHA-256 digest → HMAC-SHA256
// over the digest → log total bytes + digest prefix. Everything CPU-heavy
// here is exactly what the relay worker would do.

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const src = url.searchParams.get('src');
    if (!src) return new Response('missing ?src=', { status: 400 });
    if (!src.startsWith('https://raw.githubusercontent.com/Hex-Tech-Lab/')) {
      return new Response('src must start with https://raw.githubusercontent.com/Hex-Tech-Lab/', { status: 403 });
    }

    const upstream = await fetch(src);
    if (!upstream.ok || !upstream.body) {
      return new Response(`upstream fetch failed: ${upstream.status}`, { status: 502 });
    }

    if (url.searchParams.get('mode') === 'passthrough') {
      // Baseline: no tee, no collect — just relay the body untouched.
      return new Response(upstream.body, { status: 200, headers: { 'content-type': 'text/plain', 'x-spike-s3': 'passthrough' } });
    }

    const [branch1, branch2] = upstream.body.tee();

    ctx.waitUntil(persistBranch(branch2, env, url.searchParams.get('mode') === 'collect'));

    // Branch 1 back to the client unchanged (pass-through, zero compute per byte).
    return new Response(branch1, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=x-unknown', 'x-spike-s3': '1' },
    });
  },
};

async function persistBranch(body, env, collectOnly) {
  const chunks = [];
  let total = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }

  const flat = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    flat.set(c, off);
    off += c.byteLength;
  }

  if (collectOnly) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ spike: 's3', mode: 'collect-only', bytes: total }));
    return;
  }
  const digest = await crypto.subtle.digest('SHA-256', flat);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SPIKE_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, digest);
  const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ spike: 's3', bytes: total, digest: hex(digest).slice(0, 16), hmac: hex(mac).slice(0, 16) }));
}
