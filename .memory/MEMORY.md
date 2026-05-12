# Quick Reference for Next Session

## Current Status: 90% Complete, Blocked on Cleanup

### What's Done ✅
- Ultimate Content Intelligence v3.2 framework (16 sections, fully tested)
- Cloudflare Worker (yt-intel, live, responding)
- Skill logic (index.ts, integrated with worker)
- GitHub repo (PUBLIC, all code pushed, Hex-Tech-Lab org)
- Documentation (README, CLAUDE.md, manifest.json)

### What's Blocked ⚠️
- 4 workers in Cloudflare (need to delete 3)
- Subdomain references (kellybakri vs hex-tech-lab inconsistency)
- Skill registration (pending worker cleanup)

### Decisions Needed by User
1. **Confirm subdomain**: hex-tech-lab.workers.dev (not kellybakri)
2. **Approve worker deletion**: Delete youtube-intelligence, youtube-intelligence-production, yt-intel-prod via wrangler CLI

### Once Approved, CC Executes:
```bash
wrangler delete youtube-intelligence --yes
wrangler delete youtube-intelligence-production --yes
wrangler delete yt-intel-prod --yes

# Update all docs
grep -r "kellybakri" . --include="*.md" --include="*.json" | sed 's/kellybakri.workers.dev/hex-tech-lab.workers.dev/g'

# Commit cleanup
git commit -m "cleanup: consolidate workers, correct subdomain references"
git push origin master
```

### Then CCD Registers Skill
- Manifest: https://github.com/Hex-Tech-Lab/hex-yt-intel/blob/master/skill/manifest.json
- Trigger: @hex-yt-intel
- Endpoint: https://yt-intel.hex-tech-lab.workers.dev/fetch-metadata

### Key Files
- wrangler.toml (CC owns, must fix name collision)
- skill/manifest.json (CCD uses for registration)
- CLAUDE.md (source of truth for deployment status)
- GitHub repo (single source of truth)

### Latest Commits
- Critical fixes: 16-section framework, Paris region
- Worker deployment and testing
- GitHub repository creation and docs

## Next Session Checklist
- [ ] User approves worker cleanup & subdomain
- [ ] CC executes deletion + doc update
- [ ] CCD registers skill with Claude Skills Platform
- [ ] Test in Claude Web (CCW)
- [ ] Mark complete ✅
