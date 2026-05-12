# Strategic Decisions Made

## Framework Choice: v3.2 (16 sections)
**Decision**: Use Ultimate Content Intelligence v3.2, not 7-dimension summary
**Why**: Comprehensive analysis required; metadata extraction essential for framework
**Cost**: Higher processing time, but higher intelligence output

## Worker Region: Paris (eu-west-3)
**Decision**: Default to Paris for all Cloudflare services (and all future services)
**Why**: Marseille submarine cable landing optimal for Cairo routing (~50-60ms RTT)
**Rule**: Paris is standard for all Hex-Tech-Lab services going forward

## Subdomain: hex-tech-lab.workers.dev
**Decision**: Use organization subdomain (not personal kellybakri)
**Why**: Professional branding, team scalability, consistency
**Action**: Update all references from kellybakri → hex-tech-lab

## Worker Consolidation: Single yt-intel
**Decision**: Keep only one worker, delete 3 accidental variants
**Why**: Cost, maintenance, clarity, prevents routing confusion
**Action**: Delete via wrangler CLI (not dashboard)

## Skill Deployment: Two-layer registration
**Decision**: Create global user skill + Claude Skills Platform registration
**Why**: Local availability + platform discovery
**Timeline**: After worker cleanup complete
