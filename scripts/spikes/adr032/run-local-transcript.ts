import { TranscriptExtractor } from '../../../worker/src/services/TranscriptExtractor';

const ids = process.argv[2]?.split(',') ?? ['dQw4w9WgXcQ'];

for (const id of ids) {
  const start = performance.now();
  try {
    const r = await new TranscriptExtractor(process.env.RESIDENTIAL_PROXY_URL, process.env.DECODO_API_KEY).fetch(id);
    const isPlaceholder = r.transcript.length < 200;
    console.log(id, 'ok len=' + r.transcript.length, Math.round(performance.now() - start) + 'ms', 'lang=' + r.language, isPlaceholder ? 'PLACEHOLDER' : 'REAL');
  } catch (e) {
    console.log(id, 'ERROR', e instanceof Error ? e.message : String(e));
  }
}