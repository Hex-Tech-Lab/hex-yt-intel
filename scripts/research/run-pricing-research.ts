import fs from 'fs';
import path from 'path';

const SERPAPI_KEY = process.env.SERPAPI_API_KEY;
const EXA_KEY = process.env.EXA_API_KEY;
const DECODO_USER = process.env.DECODO_FASTSEARCH_USER;
const BRAVE_KEY = process.env.BRAVE_API_KEY;
const BRIGHTDATA_TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

const REQUIRED_ENV_VARS = ['SERPAPI_API_KEY', 'EXA_API_KEY', 'DECODO_FASTSEARCH_USER', 'BRAVE_API_KEY', 'OPENROUTER_API_KEY'] as const;

interface Result {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

async function serpapiSearch(query: string): Promise<Result[]> {
  try {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(query)}&num=10&api_key=${SERPAPI_KEY}`;
    const res = await fetch(url);
    const data = await res.json() as any;
    return (data.organic_results || []).filter((item, i) => i < 8).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet || '',
      source: 'serpapi',
    }));
  } finally {
    // cleanup
  }
}

async function decodoSearch(query: string): Promise<Result[]> {
  try {
    const res = await fetch('https://fastsearch.decodo.com/v0/search', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Basic ${DECODO_USER}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });
    const data = await res.json() as any;
    return (data.organic || []).filter((item, i) => i < 8).map((r: any) => ({
      title: r.title,
      url: r.link,
      snippet: r.description || '',
      source: 'decodo',
    }));
  } finally {
    // cleanup
  }
}

async function exaSearch(query: string): Promise<Result[]> {
  try {
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EXA_KEY || '',
      },
      body: JSON.stringify({ query, numResults: 8 }),
    });
    const data = await res.json() as any;
    return (data.results || []).filter((item, i) => i < 8).map((r: any) => ({
      title: r.title,
      url: r.url || r.id,
      snippet: r.text || r.title,
      source: 'exa',
    }));
  } finally {
    // cleanup
  }
}

async function braveSearch(query: string): Promise<Result[]> {
  try {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': BRAVE_KEY || '',
      }
    });
    const data = await res.json() as any;
    return (data.web?.results || []).filter((item, i) => i < 8).map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.description || '',
      source: 'brave',
    }));
  } finally {
    // cleanup
  }
}

async function perplexitySearch(query: string): Promise<Result[]> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'perplexity/sonar-pro',
      messages: [{ role: 'user', content: query }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Perplexity API failed: ${res.status}`);
  }
  const data = await res.json() as any;
  return [{
    title: `Perplexity: ${query}`,
    url: `https://openrouter.ai?q=${encodeURIComponent(query)}`,
    snippet: data.choices?.[0]?.message?.content || '',
    source: 'perplexity'
  }];
}

function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

async function main() {
  validateEnv();

  const queries = [
    'youtube video summarizer pricing plans Eightify NoteGPT Glasp Summarize.tech YouLearn Recall Tactiq Merlin Notta Descript',
    'Eightify pricing plans pro quota limits',
    'NoteGPT pricing plans limits',
    'Merlin AI youtube summarize pricing limits',
    'Notta AI transcribe pricing',
  ];

  const allResults: Record<string, Result[]> = {};
  const combined: Result[] = [];

  for (const q of queries) {
    console.log(`\n=== Searching: ${q} ===`);
    const [serp, decodo, exa, brave, perplexity] = await Promise.all([
      serpapiSearch(q),
      decodoSearch(q),
      exaSearch(q),
      braveSearch(q),
      perplexitySearch(`Research the pricing plans, quotas, usage limits, and summary depths (how detailed are the summaries?) for YouTube summarizer AI tools, specifically: Eightify, NoteGPT, Glasp, Summarize.tech, YouLearn, Recall, Tactiq, Merlin, Notta, Descript. Provide specific prices and numbers. Focus on: ${q}`),
    ]);
    console.log(`SerpAPI: ${serp.length}, Decodo: ${decodo.length}, Exa: ${exa.length}, Brave: ${brave.length}, Perplexity: ${perplexity.length}`);
    const resList = [...serp, ...decodo, ...exa, ...brave, ...perplexity];
    allResults[q] = resList;
    combined.push(...resList);
  }

  const unique = Array.from(new Map(combined.map(r => [r.url, r])).values());
  console.log(`\nTotal unique: ${unique.length}`);

  const outPath = path.join(process.cwd(), 'docs/research/pricing-results.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ queries, allResults, unique }, null, 2));
  console.log(`Wrote benchmark to ${outPath}`);
}

main().catch(console.error);
