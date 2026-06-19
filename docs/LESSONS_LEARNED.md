# Lessons Learned

## Provider & Library Notes

### Decodo (formerly Smartproxy) Scraper API

**Base URL:** `https://scraper-api.decodo.com/v2/scrape`

**Auth:** Basic auth with API token as password, empty username:
```
Authorization: Basic <base64(":" + API_TOKEN)>
```

**Known Targets:**

| Target | Params | Returns |
|---|---|---|
| `youtube_subtitles` | `query: videoId` | `results[0].content.auto_generated.<lang>.events` with `segs[].utf8` |
| `youtube_metadata` | `query: videoId` | Video metadata JSON |
| `youtube_channel` | `query: channelId/@handle`, `parse: true`, `limit: N` | Channel metadata |
| `tiktok_post` | `url: full video URL` | TikTok post data |
| `tiktok` | `url: full URL`, `headless: "html"`, `user_agent_type: "desktop_chrome"` | TikTok page HTML |
| `tiktok_shop_product` | `product_id: id`, `headless: "html"`, `device_type: "desktop_chrome"`, `country: "gb"` | Product data |
| `universal` | `url: target URL` | Raw page HTML |

**Key findings:**
- ❌ `api.decodo.com/v1/transcript/` does NOT exist (404). Old endpoint was removed.
- ❌ `youtube_transcript` target does NOT exist. Use `youtube_subtitles`.
- ❌ `target: "universal"` with `parser: {type: "text", name: "youtube_transcript"}` returns raw HTML, not parsed transcript.
- ✅ `youtube_subtitles` is the correct target for transcripts.
- ⚠️ Response structure: `{ results: [{ content: { ... } }] }` — not `{ transcript: "..." }`.
- ⚠️ Transcript events use `segs[].utf8` format, same as YouTube's native caption JSON.

**YouTube Transcripts:**
- Content structure: `results[0].content.auto_generated.<lang>.events`
- Each event has `segs` array with `utf8` fields
- Some events are line breaks (`aAppend: 1, segs: [{utf8: "\n"}]`)
- Filter events that have `segs` before joining

**TikTok Integration (Future):**
- `tiktok_post` target: provide full video URL
- `tiktok_shop_product`: requires `product_id`, `device_type`, `country`
- `tiktok` for shop search: use `headless: "html"`, `user_agent_type: "desktop_chrome"`

---

### Cloudflare Workers

- **Wrangler deploy** requires `CLOUDFLARE_API_TOKEN` env var in non-interactive environments.
- `fetchWithProxy` uses Cloudflare's `proxy` extension (`@ts-ignore`) — only works in CF Workers runtime, not Node.js.
- CF Workers `fetch` to YouTube timedtext API returns empty from CF IPs — residential proxy is required.
- **DO NOT** use bare `fetch()` for YouTube API calls from Workers — always use `fetchWithProxy`.
- `fast-xml-parser` is used for YouTube caption metadata XML parsing.

---

### YouTube Transcript Extraction (3-Tier Cascade)

1. **Decodo `youtube_subtitles`** (primary) — works, but 30s timeout
2. **YouTube Native** (fallback):
   a. Standard timedtext API (`/api/timedtext?v=...&lang=en&fmt=json`) — may return empty from CF IPs
   b. Page HTML extraction (`fetchFromPageHTML`) — fetch watch page, regex extract `captionTracks`, fetch transcript URL
3. **Tertiary** (last resort) — returns placeholder transcript

**Critical:** The `fetchFromPageHTML` transcript URL fetch MUST use `fetchWithProxy`, not bare `fetch()`.

**Regex for captionTracks:** `/"captionTracks":\s*(\[[\s\S]*?\])\s*,/`
- Greedy `[\s\S]*?` handles nested JSON
- Trailing `,` boundary prevents partial matches

---

### Supabase

- Schema cache can go stale after manual DB alterations — need PostgREST schema refresh.
- RLS policies must be tested with `supabase test db` before deploy.
- `@supabase/ssr` is the preferred client library for Next.js App Router.

---

### Next.js / Vercel

- Edge Runtime has ~8s timeout for auth/quota checks.
- Streaming responses extend connection lifetime — always stream from API routes.
- Lazy-load heavy modules (Supabase client, etc.) with `import()` to avoid blocking initial render.
- `useTransition` for non-urgent state updates to improve INP.

---

### Testing

- Playwright for E2E (Chromium only, full parallel)
- Vitest for unit tests
- Pre-commit: `type-check` + `lint` + `test`

---

### Git & PR

- Commit messages: `<type>(<scope>): <description>` — e.g., `fix(worker): rewrite Decodo integration`
- Never commit secrets, strategic decisions, or business logic to Git.
- PR confidence ≥85% for merge: Cubic(30), CodeRabbit(20), Snyk(15), CI/CD(10), Vercel(5), CodeQL(5).
