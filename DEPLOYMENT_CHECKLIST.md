# Deployment Checklist

## Phase 1: Preparation

- [ ] Cloudflare account created (free tier)
- [ ] Google Cloud account created
- [ ] YouTube Data API v3 enabled
- [ ] YouTube API key generated

## Phase 2: Local Setup

- [ ] Node.js 24 installed (`nvm use`)
- [ ] Dependencies installed (`pnpm install`)
- [ ] Worker dependencies installed (`cd worker && pnpm install`)
- [ ] Wrangler CLI installed (`pnpm install -g wrangler`)

## Phase 3: Worker Deployment

- [ ] Authenticated with Cloudflare (`wrangler login`)
- [ ] YouTube API key set as secret (`wrangler secret put YOUTUBE_API_KEY`)
- [ ] Worker built successfully (`cd worker && pnpm build`)
- [ ] Worker deployed to Cloudflare (`wrangler deploy`)
- [ ] Deployment verified (`wrangler deployments list`)
- [ ] Endpoint tested locally (`curl http://localhost:8787/fetch-metadata?video_id=...`)
- [ ] Endpoint tested live (`curl https://youtube-intelligence.workers.dev/fetch-metadata?video_id=...`)

## Phase 4: Skill Testing

- [ ] Skill configuration set (`CLOUDFLARE_WORKER_URL=...`)
- [ ] Skill tested with valid video ID (`pnpm skill "https://..."`)
- [ ] URL parsing verified
- [ ] Metadata fetching verified
- [ ] Prompt generation verified
- [ ] Output format correct (markdown)

## Phase 5: Production Validation

- [ ] Tested with 3+ different videos
- [ ] Tested with different URL formats
  - [ ] youtube.com/watch?v=ID
  - [ ] youtu.be/ID
  - [ ] youtube.com/embed/ID
- [ ] Error handling tested
  - [ ] Invalid URL
  - [ ] Private video
  - [ ] Non-existent video
- [ ] Performance validated (<2 sec skill time)
- [ ] Fallback graceful (metadata unavailable → prompt still generated)

## Phase 6: Documentation

- [ ] README.md updated
- [ ] WORKER_DEPLOYMENT.md reviewed
- [ ] QUICKSTART.md reviewed
- [ ] Examples verified
- [ ] Troubleshooting guide tested

## Phase 7: Integration

- [ ] Skill registered with Claude Code
- [ ] Prompt ready for CCW context
- [ ] Analysis workflow documented
- [ ] Output format verified with Claude

## Phase 8: Monitoring

- [ ] Worker logs enabled (`wrangler tail`)
- [ ] Error tracking setup
- [ ] API quota monitoring (YouTube 10K/day)
- [ ] Cloudflare metrics accessible

## Go/No-Go Decision

### GO Criteria
- [ ] All tests passing
- [ ] No errors in logs
- [ ] Performance acceptable
- [ ] Documentation complete
- [ ] Fallback graceful

### NO-GO Criteria
- [ ] API key issues
- [ ] Worker deployment failures
- [ ] Skill parsing errors
- [ ] Unhandled exceptions

## Post-Deployment

### Day 1
- [ ] Monitor error logs
- [ ] Test with production videos
- [ ] Verify Claude integration
- [ ] Collect user feedback

### Week 1
- [ ] Review API quota usage
- [ ] Check Worker cold start times
- [ ] Analyze prompt quality
- [ ] Document lessons learned

### Month 1
- [ ] Review usage patterns
- [ ] Optimize Worker performance
- [ ] Consider caching strategy
- [ ] Plan feature additions

## Rollback Plan

**If deployment fails:**
1. Check Worker logs: `wrangler tail`
2. Verify API key: `wrangler secret list`
3. Redeploy: `wrangler deploy --force`
4. Clear cache: `wrangler purge-cache`

**If Worker is unstable:**
1. Rollback to previous version: `wrangler deployments rollback`
2. Fix code locally
3. Redeploy

## Quick Reference

```bash
# Status checks
wrangler status
wrangler deployments list
wrangler secret list

# Debugging
wrangler dev
wrangler tail
wrangler preview

# Deployment
wrangler deploy
wrangler deploy --env production
wrangler deploy --force

# Configuration
wrangler secret put YOUTUBE_API_KEY
wrangler env list
```

## Success Criteria

✅ **Skill successfully:**
- Parses YouTube URLs
- Fetches metadata via Worker
- Generates analysis prompts
- Handles errors gracefully

✅ **Worker successfully:**
- Responds to requests <600ms
- Returns proper JSON
- Handles invalid inputs
- Uses API keys securely

✅ **Integration:**
- Prompts work with Claude
- No API key leaks
- Fallback when offline
- Clear error messages

---

**Status:** Ready for deployment ✨

**Last Updated:** 2026-05-12
