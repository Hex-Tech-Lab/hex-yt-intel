# hex-yt-intel Project Status

**Last verified against live code**: 2026-07-07 (preflight audit — every claim below was checked against `main` @ `4b16de2`, not assumed from prior docs)
**Superseded**: everything below this line replaces the previous version of this file, which described a 2026-05-12-era state (PR #62, Cloudflare subdomain consolidation, "PLATINUM READINESS") that is no longer the current reality. That content is preserved in git history if needed; it is not current.

**Full narrative/rationale for the most recent work**: `docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md`
**ADR ledger**: `CLAUDE.md` §3 (backfilled this session — was stale at ADR 005 for weeks while 006/007 shipped)

---

## How this file works

This is a **status snapshot**, not a changelog — it says what's true right now, grouped by theme, with a code reference for anything non-obvious. When something here goes stale, don't patch around it — replace the relevant section outright, the way this whole file was just replaced. **Do not extend this file's prior "Cloudflare worker consolidation" narrative; that chapter is closed.**

---

## 1. What's live on `main` (verified, not assumed)

### Core pipeline
- 11-dimension UCIS synthesis, streamed from the Cloudflare Worker (`worker/src/chat-stream.ts`, `worker/src/services/LLMCascade.ts`) to the browser directly (Hybrid Edge Architecture, ADR 005).
- **Dimension 0 — Executive Digest** (ADR 010, PRs #124/#127): one cheap, idempotent, cached completion producing a 3-tier summary (Snapshot / Key Takeaways / Overview) on first view of a completed full analysis. Lives in `analyses.executive_digest jsonb`. Rendered above the 1..11 grid via `ExecutiveDigestCard.tsx`.
- Stuck-analysis reaper (ADR 007, PR #110): QStash-driven sweep that finalizes rows orphaned in `processing` status.
- Video-centric history overview (PRs #111, #114, #122): one row per underlying video, dimension-completeness strip (green=generated/orange or dashed-hollow=missing depending on component), Views chip wired to a real `viewed_count` increment (PR #116, RPC-based, race-safe).

### Chat
- Grounded strictly in the bound analysis; **hard-refuses** (no stream token minted, persisted honest message instead) if the analysis has no usable markdown — no transcript, failed, or still processing (ADR 008, PR #125). This closed the leak where the chat would answer from general knowledge (observed: a fabricated recipe for a no-transcript video).
- Conversations can only be bound to an analysis the creating user owns — verified at creation (404 if not owned) and re-scoped by `userId` at every grounding read, so even a hypothetical stale cross-bound conversation can't leak another user's analysis content (ADR 009, PR #126). This closed the "double leak" companion bug (chat attributing answers to a different video/user's analysis).
- `CHAT_PROTOCOL` (`web/lib/config/prompts.ts`) refuses identity probes and jailbreak/role-change attempts, steering back to the video. This is bundled into the Worker by esbuild — it is the only copy, no separate worker-side prompt to keep in sync.
- **Not yet built**: a full red-team/identity-defense orchestration layer (logging attempts, escalation, rate-limiting probes) — task #58, explicitly the larger follow-on the minimum gate above was scoped to unblock.

### Security posture (as of this preflight)
- The one confirmed IDOR (chat conversation↔analysis binding, above) is fixed.
- **Open, unaudited risk**: the pattern that caused it — a route using `getSupabaseServiceClient()` (RLS bypassed) with a client-supplied foreign-key-like ID and no explicit ownership check — was only checked for the one instance found. Task #64 tracks a repo-wide sweep for the same pattern elsewhere; **this has not been done yet.**

### Visualization (Knowledge Graph / Word Cloud / Mind Map)
- All three already have real, working implementations — **this was not obvious from the task list before this preflight**, which had them marked "pending" as if nothing existed. Verified in code:
  - `WordCloud.tsx`: real Archimedean-spiral collision-free layout + size-by-weight font scaling. (Matches the fix in `docs/history/SESSION_EXIT_2026_07_01.md` §1.4, which had never been reflected in the task tracker.)
  - `KnowledgeGraphCanvas.tsx`: conditional label rendering (active/neighbor/high-weight nodes always, others past a zoom threshold — deliberate anti-clutter design) and weight-scaled node radius (`r = 4 + weight*5`, roughly).
  - `MindMap.tsx`: computed per-node coordinates with real cubic-bezier connector paths (not a stub).
- **Still genuinely open**: task #53 — the KG's current scaling is linear and, per live user feedback, node circles read as too large with the weight→size curve too flat. This is a refinement of a real implementation, not a "build it from scratch" task — don't re-scope it as the latter.
- **Confirmed regression, not just staleness**: an `.memory/AGENT_LEDGER.md` entry from 2026-06-19 claims a `TimestampLink` component was built and wired into `DimensionDrawer`/`StreamingGrid` for clickable video-timestamp jumps. **`TimestampLink` does not exist anywhere in the current codebase.** `StreamingGrid` itself appears to have been superseded by the accordion-based dimension UI (Wave 1.8.4, per the ledger). This was almost certainly dropped silently during that later UI rewrite and nobody caught it. Task #39 ("Video time-seek UI") is correctly still open — but note for future sessions: **ledger `[DONE]` entries are not permanent proof of current state; a later refactor can drop earlier work without anyone updating the ledger.** Don't take a `[DONE]` line as verified without checking the code it refers to still exists.

### Export
- PDF export (`web/app/api/analyses/[id]/export/route.ts`, PDFKit) already has real formatting: title page, tier-gated Table of Contents, per-heading-level font/color hierarchy. **Not a text-dump** — this appears to have been resolved already; task #23 closed this preflight on that evidence.
- MD export downloads raw `analysis_markdown` as a `.md` Blob client-side — correct/expected behavior for that format, not a defect.

### Mobile
- Sign-in button clipping/double-height, back-button-to-sign-in, dimension-input copy/reset button overflow — all fixed (#26, #50, #51, #119, #123).
- **Not built**: a mobile bottom tab-bar (4-5 icons). What exists is a drawer-style sidebar nav (`setMobileNav`/`MobileNav` in `DashboardLayout.tsx`) — a different pattern. Task #52 genuinely open, confirmed by broader grep this preflight (not just a naming mismatch).

---

## 2. Architecture facts worth restating (things that surprised or tripped up work this session)

- **`CHAT_PROTOCOL` is single-sourced into the Worker via esbuild** — editing `web/lib/config/prompts.ts` is sufficient; there is no separate worker copy to hand-sync. Verify this is still true before assuming a prompt change reached the worker without a worker-side code change.
- **Any route using `getSupabaseServiceClient()` gets zero protection from Postgres RLS** — by design, for legitimate S2S writes — which means every such route needs its own explicit, in-code ownership/authz check. This is not optional and is not covered by "RLS is enabled on `analyses`" claims elsewhere in older docs (`docs/architecture-index.md` — see §3 below).
- **qa-intel (`scripts/verify-quality-engine.ts`) must be run from the repo root**, not from `web/`, or it fails with `ERR_MODULE_NOT_FOUND`. CI blocks only on HIGH severity; MEDIUM/LOW are advisory.
- **DeepSource/Codacy/CodeFactor/cubic are not required GitHub checks** on this repo — the required set is Lint, Type Check, Build, Security Check, CodeQL, Worker TypeCheck, Pipeline Status. Advisory-tool findings should be triaged (fixed if they point at something real, explicitly skipped with a reason if cosmetic) but never block a merge on their own.

---

## 3. Known-stale docs (flagged, not fixed — out of scope for a status snapshot)

- `docs/architecture-index.md` — versioned 1.0.0, dated 2026-05-19, describes a pre-Hybrid-Edge-Architecture system (all-Vercel-serverless, no Worker streaming, superseded rate-limit file paths, an outdated model chain). Do not treat it as current. A full rewrite needs its own dedicated session, not an incidental patch.
- `docs/PRD.md`, `docs/ROADMAP_MVP_2_0_TO_3_5.md` — not reviewed for accuracy this session; no claim made either way. Treat as unverified, not as confirmed-current or confirmed-stale.
- `.memory/decisions.md`, `.memory/lessons.md` (lessons 1-8), `.memory/MEMORY.md` — predate this file's rewrite and describe the Cloudflare-worker-consolidation / v3.2-framework era (2026-05-12). Historically accurate for that era, not current-state claims. `.memory/lessons.md` has lessons 9-12 appended this session (2026-07-07) that ARE current.

---

## 4. Pending work (verified still open, not just "not recently touched")

Grouped by theme, task-tracker IDs in parens for continuity:

**Security**
- (#64) Sweep service-client routes for the same missing-ownership-check pattern that caused the chat IDOR (§1 above) — only one instance has been found/fixed, no repo-wide audit done.
- (#58) Full chat red-team / identity-defense orchestration layer — the minimum grounding+refusal gate is live (ADR 008); this is the larger, explicitly-deferred next increment (logging/escalating jailbreak attempts, rate-limiting probing behavior, etc.).

**Visualization refinement**
- (#53) KG node-size scaling: circles too large, weight→size curve too flat — real implementation exists, needs a scaling-formula pass, not a rebuild.

**Content pipeline / data model**
- (#34) Dimension reordering — design review, no changes yet.
- (#44) Normalize dual persist formats (`analysis_markdown` text + `analysis_payload` jsonb both written on every persist) to one canonical format — confirmed still dual-write in `SupabasePersistenceAdapter.ts`.
- (#55) Amber "thin/insufficient-data" per-dimension tier — needs a per-dimension substantive-content signal; there's already an in-code comment in `AnalysisHistory.tsx` marking exactly where this hooks in.

**Mobile**
- (#52) Mobile-only bottom navigation bar (4-5 icons) — confirmed not built; current mobile nav is a drawer, not a tab bar.

**Transcript/search epic (large, multi-task, none started)**
- (#36) Ephemeral transcript store (timestamps, ≤3-day TTL, auto-purge).
- (#37) Timestamp synthesis → persistent seek-markers that survive transcript purge.
- (#38) Search augmentation via transcript + persisted index.
- (#39) Video time-seek UI (jump video from dimension/chat timestamp markers) — see the `TimestampLink` regression note in §1; whatever existed before is gone now, this needs a fresh build, not a "restore."

**Tooling**
- (#43) `web/scripts/pr-review-workflow.sh` is still a theatrical stub (hardcoded `PR_ID=21`, bare `sleep 600`/`sleep 900` calls, no real logic) — confirmed by direct read this preflight. Needs a real implementation.

**Explicitly deferred (roadmap, not now — do not pick these up without being asked)**
- (#40) MoR + real payment integration (post-stabilization).
- (#46) Whisper ASR fallback for caption-less videos.
- (#56) Music-only/no-speech Shorts with on-screen text (needs Whisper/OCR — same dependency as #46).

---

## 5. If you're starting a new session from this file

1. Read `docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md` for the most recent work's full rationale (inflections, ADRs, lessons).
2. Treat this file's §1 as current-state ground truth, but re-verify anything load-bearing against the actual code before building on it — that's exactly the discipline that caught the `TimestampLink` regression and the already-fixed word-cloud/KG-label items this session.
3. Pick up from §4 (Pending work) — it's the accurate backlog, reconciled against code as of `main` @ `4b16de2`.
4. If you find this file itself has gone stale, don't patch around the drift — rewrite the affected section wholesale and note what you verified, the way this rewrite did.
