# hex-yt-intel: Master Development Context

## PROJECT MISSION
Single skill: YouTube Content Intelligence
Input: YouTube URL
Output: Markdown report (Ultimate Content Intelligence v3.2)
Execution: Fully automated, zero manual intervention, same CCW session
Cost: Zero (Cloudflare free + Claude subscription)

## ARCHITECTURE

### Component 1: Cloudflare Worker (Metadata Fetcher)
- Endpoint: https://youtube-intelligence.workers.dev/fetch-metadata
- Method: GET
- Params: ?video_id={id}
- Auth: Bearer token (CLOUDFLARE_SECRET_TOKEN)
- Response: JSON {title, publishedAt, channelId, channelTitle, viewCount, likeCount, commentCount}
- Environment:
  * YOUTUBE_API_KEY
  * CLOUDFLARE_SECRET_TOKEN
- Deployment: Via Cloudflare wrangler (in progress: 2026-05-12)
- Status: UPLOADED (awaiting workers.dev subdomain or route config)

### Component 2: hex-yt-intel Skill
- Location: skill/src/index.ts
- Input: YouTube URL (string)
- Processing:
  1. Extract video_id from URL
  2. Call Worker → fetch metadata
  3. Fetch transcript (via YouTube API or placeholder)
  4. Embed Ultimate Content Intelligence v3.2 prompt
  5. Auto-populate metadata into prompt
  6. Return formatted markdown
- Output: Markdown report (16 sections, complete analysis)
- Execution context: CCW (Claude Web)
- Cost: Uses subscription, no API calls
- Status: READY (dependencies installed, code complete)

## TECH STACK (FROZEN)
- Language: TypeScript (strict mode, type aliases, no any)
- Runtime: Node.js 20+
- Skill framework: Claude Skills API
- Cloudflare: Workers + Pages (if needed)
- APIs: YouTube Data API v3, Claude API (via CCW)
- Git: GitHub (Hex-Tech-Lab org)

## PROJECT STRUCTURE
```
~/projects/hex-yt-intel/
├── worker/
│   ├── wrangler.toml
│   ├── src/
│   │   ├── index.ts
│   │   └── types.ts
│   ├── package.json
│   └── tsconfig.json
├── skill/
│   ├── manifest.json
│   ├── src/
│   │   ├── index.ts (main)
│   │   ├── types.ts
│   │   ├── prompts.ts (Ultimate Content Intelligence v3.2)
│   │   └── worker-client.ts
│   ├── package.json
│   └── tsconfig.json
├── CLAUDE.md (this file)
├── README.md
└── .gitignore
```

## DEVELOPMENT STATUS

### Completed
- [x] GitHub repo created (hex-yt-intel)
- [x] WSL project scaffolded
- [x] Directory structure initialized
- [x] Worker code drafted
- [x] Skill logic drafted
- [x] Worker dependencies installed
- [x] Worker built (dist/worker.js - 63.9KB)
- [x] Worker uploaded to Cloudflare
- [x] Skill dependencies installed

### In Progress
- [ ] Worker configuration (workers.dev subdomain or route)
- [ ] Worker endpoint testing
- [ ] End-to-end skill + worker integration

### Pending
- [ ] Final skill deployment to Claude Skills
- [ ] Live testing in CCW
- [ ] Documentation finalization

## CURRENT BLOCKERS
1. **Worker Activation**: Need workers.dev subdomain OR route configuration
   - Option A: Register workers.dev at https://dash.cloudflare.com/d28d44fcd9087c54845a8fb8df1c001e/workers/onboarding
   - Option B: Use existing domain + add route to wrangler.toml
2. **Skill Registration**: Register skill manifest with Claude Skills platform once worker is live

## NEXT IMMEDIATE ACTION
1. CC: Deploy Worker via Cloudflare MCP
2. CC: Build skill logic (skill/src/index.ts)
3. CC: Test Worker endpoint (curl)
4. CC: Test skill (invoke with test URL)
5. CC: Return live skill URL + test results

## COMMANDS
```bash
# Worker
cd ~/projects/hex-yt-intel/worker
npm install
wrangler deploy

# Skill
cd ~/projects/hex-yt-intel/skill
npm install
npm run build

# Test
curl -H "Authorization: Bearer [TOKEN]" \
  "https://youtube-intelligence.workers.dev/fetch-metadata?video_id=M-uUFLU9IFU"
```

## SESSION CONTINUITY
- This file is read at every CC session start
- Update status, blockers, and progress here
- Keep timestamps of major milestones
- Never delete this file

## NOTES
- No Claude API key calls from skill (uses CCW subscription)
- No man-in-the-middle; fully automated
- Zero user intervention once skill invoked
- Markdown output is production-ready
