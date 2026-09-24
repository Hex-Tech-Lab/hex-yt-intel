#!/usr/bin/env node
// Reads spike:s4:<runId> keys from Upstash via REST (values never printed raw beyond metrics).
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const env = fs.readFileSync(path.join(root, 'web/.env.local'), 'utf8');
const get = (k) => { const m = env.match(new RegExp('^' + k + '=(.*)$', 'm')); return m ? m[1].trim() : null; };
const url = get('UPSTASH_REDIS_REST_URL');
const token = get('UPSTASH_REDIS_REST_TOKEN');
const ids = process.argv.slice(2);
(async () => {
  for (const id of ids) {
    const res = await fetch(`${url}/get/spike%3As4%3A${encodeURIComponent(id).replace('%3A', ':')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const j = await res.json();
    if (j.result === null || j.result === undefined) { console.log(id, '-> MISSING'); continue; }
    const m = typeof j.result === 'string' ? JSON.parse(j.result) : j.result;
    console.log(id, '->', JSON.stringify({
      rawBytes: m.rawBytes, textBytes: m.textBytes, finishReason: m.finishReason,
      model: m.model, firstByteAt: m.firstByteAt, upstreamDoneAt: m.upstreamDoneAt,
      persistedAt: m.persistedAt, upstreamError: m.upstreamError,
    }));
  }
})();