/* Articulation Exercise: GLM-5.3-flash extraction (12 dims) -> single
 * GPT-OSS-120B (Groq) articulation pass -> split by markers -> Jev grades
 * (transcript-grounded parity + style vs baseline) vs the GLM-only and
 * GPT-OSS-only stripe scores. Diagnostic experiment per user directive. */
import * as fs from 'fs';

const env: Record<string, string> = {};
for (const line of fs.readFileSync('/home/kellyb_dev/projects/hex-yt-intel/.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const SB_URL = env['NEXT_PUBLIC_SUPABASE_URL'], SB_KEY = env['SUPABASE_SERVICE_ROLE_KEY'], OR_KEY = env['OPENROUTER_API_KEY'];
const VIDEO = process.argv[2] ?? 'Z6l4HpuyyP0';

async function run(model: string, system: string, user: string, provider: { order: string[] }, tokens = 16000): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'hex-yt-intel/articulation-exercise' },
    body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.3, max_tokens: tokens, reasoning: { effort: 'minimal' }, provider }),
    signal: AbortSignal.timeout(180000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json() as { choices?: { message?: { content?: string } }[] };
  return d.choices?.[0]?.message?.content?.trim() ?? '';
}

const LEGEND = Array.from({ length: 10 }, (_, i) => `Grade ${i} out of 9 — 9 means all key facts captured; 0 means nothing captured`);
async function jev(state: Record<string, unknown>, questions: Record<string, unknown>): Promise<Record<string, { score?: number }> | null> {
  const res = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OR_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'hex-yt-intel/articulation-exercise' },
    body: JSON.stringify({ model: '~typesafe/jev-latest', state, questions }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) { console.error('[jev]', res.status, (await res.text()).slice(0, 150)); return null; }
  const d = await res.json() as { answers?: Record<string, { score?: number }> };
  return d.answers ?? null;
}
const to100 = (s?: number) => s === undefined || !Number.isFinite(s) ? 0 : Math.round((Math.max(0, Math.min(9, s)) / 9) * 100);

const hdr = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
const a = await (await fetch(`${SB_URL}/rest/v1/analyses?select=analysis_payload&billing_status=eq.completed&video_id=eq.${VIDEO}&limit=1`, { headers: hdr })).json() as any[];
const p = a[0].analysis_payload;
const t = await (await fetch(`${SB_URL}/rest/v1/transcripts?select=content&video_id=eq.${VIDEO}&limit=1`, { headers: hdr })).json() as any[];
const transcript: string = t[0]?.content ?? '';
console.log(`video ${VIDEO}, transcript ${transcript.length} chars`);

// 1. GLM extraction, one call per dimension (12 calls)
const dims: { num: number; name: string; baseline: string; glm: string }[] = [];
const digestBaseline = [p.executive_digest?.snapshot, ...(p.executive_digest?.takeaways ?? []), p.executive_digest?.overview, p.executive_digest?.detailedSummary].filter(Boolean).join('\n\n');
const entries: { num: number; name: string; baseline: string }[] = [
  { num: 0, name: 'Executive Digest', baseline: digestBaseline },
  ...(p.dimensions ?? []).map((d: any) => ({ num: d.number as number, name: d.name as string, baseline: (d.content ?? '') as string })),
];
for (const e of entries) {
  if (!e.baseline.trim()) { console.log(`skip dim ${e.num} (empty baseline)`); continue; }
  const sys = `You are Hex-YT-Intel's UCIS analysis engine.\nAnalyze this YouTube transcript for Dimension ${e.num}: "${e.name}".\nExtract the substance. Analytical, dense, objective. Do not invent facts not in the transcript. Output only the dimension content.`;
  const out = await run('z-ai/glm-5.3-flash', sys, transcript.slice(0, 24000), { order: ['together'] });
  dims.push({ num: e.num, name: e.name, baseline: e.baseline, glm: out });
  console.log(`extract dim ${e.num}: ${out.length} chars`);
}

// 2. Single OSS-120B (Groq) articulation pass over all extracted content
const assembled = dims.map(d => `### DIM ${d.num} ${d.name}\n${d.glm}`).join('\n\n');
const artSys = `You are the articulation editor for Hex-YT-Intel's UCIS analysis output.
Below are dimension drafts extracted from a YouTube transcript. Rewrite them for superior articulation: precise, dense, objective, analytically sharp, consistent formatting (markdown headers, bullets, bold), matching the established Hex-YT-Intel house style.
STRICT RULE: do not add, invent, or extrapolate any fact not present in the drafts. Preserve every number, entity, and claim. Preserve the section structure.
Output ONLY the rewritten content, keeping each section header exactly as "### DIM <number> <name>".`;
const articulated = await run('openai/gpt-oss-120b', artSys, assembled, { order: ['groq'] }, 20000);
console.log(`articulated: ${articulated.length} chars`);

// 3. Split by markers
const parts = new Map<number, string>();
const re = /### DIM (\d+) ?[^\n]*/g;
const marks = [...articulated.matchAll(re)];
for (let i = 0; i < marks.length; i++) {
  const num = Number(marks[i][1]);
  const body = articulated.slice((marks[i].index ?? 0) + marks[i][0].length, i + 1 < marks.length ? marks[i + 1].index : undefined).trim();
  if (body) parts.set(num, body);
}

// 4. Jev grade each articulated dim
const rows: string[] = ['num|chars|parity|style|baseline_chars'];
for (const d of dims) {
  const art = parts.get(d.num) ?? '';
  if (!art) { rows.push(`${d.num}|0|-|-|${d.baseline.length}`); continue; }
  const answers = await jev(
    { transcript: transcript.slice(0, 12000), baseline: d.baseline.slice(0, 12000), challenger: art.slice(0, 12000) },
    {
      InformationParity: { type: 'score', instructions: 'Grade Information Parity from 0 to 9: does the challenger capture the key facts, entities, arguments and data points from the TRANSCRIPT that matter for this dimension? Baseline facts not in the transcript do not count against the challenger.', criteria: LEGEND },
      StyleConsistency: { type: 'score', instructions: 'Grade Style Consistency from 0 to 9: does the challenger match the baseline tone (analytical, dense, objective), formatting and depth?', criteria: LEGEND },
    });
  const parity = to100(answers?.InformationParity?.score), style = to100(answers?.StyleConsistency?.score);
  rows.push(`${d.num}|${art.length}|${parity}|${style}|${d.baseline.length}`);
  console.log(`graded dim ${d.num}: parity=${parity} style=${style} (${art.length} chars)`);
}
fs.writeFileSync(`/tmp/opencode/articulation_${VIDEO}.md`, articulated);
fs.writeFileSync(`/tmp/opencode/articulation_${VIDEO}.csv`, rows.join('\n'));
console.log(rows.join('\n'));
