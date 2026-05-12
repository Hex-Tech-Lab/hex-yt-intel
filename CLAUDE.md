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

## WORKER DEPLOYMENT ✅ LIVE

**Endpoint**: https://youtube-intelligence.kellybakri.workers.dev/fetch-metadata
**Status**: ✅ LIVE & PRODUCTION
**Subdomain**: youtube-intelligence.kellybakri.workers.dev
**Deployed**: 2026-05-12
**Verified**: ✅ Returning live YouTube metadata

### Test Command
```bash
curl "https://youtube-intelligence.kellybakri.workers.dev/fetch-metadata?video_id=M-uUFLU9IFU"
```

## SKILL STATUS ✅ WORKING

**Location**: skill/index.ts
**Status**: ✅ Fully functional, end-to-end tested
**Verified**: ✅ Fetching metadata + generating analysis prompts

### Test Command
```bash
pnpm tsx skill/index.ts "https://www.youtube.com/watch?v=M-uUFLU9IFU"
```

## NEXT STEPS
1. Deploy skill to Claude Skills platform
2. Register manifest with Claude
3. Live testing in CCW (Claude Web)

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
