# hex-yt-intel: Quick Reference

**Purpose of this file**: a lightweight index pointing to the current source of truth — not a status narrative itself. The previous version of this file described a 2026-05-12-era state (worker subdomain consolidation, a 16-section v3.2 framework, a Claude-3.5-Haiku ban against a model roster that no longer exists) that is no longer current. That content is preserved in git history; treat none of it as live guidance.

---

## Read these, in this order, at the start of a session

1. **`.memory/project_status.md`** — current, code-verified state: what's live, what's confirmed still open, known regressions/discrepancies caught by re-checking docs against actual code. Rewritten 2026-07-07; rewrite it again wholesale (don't patch around drift) the next time it goes stale.
2. **`docs/history/HANDOVER_2026-07-07-CHAT-SECURITY-AND-DIM0.md`** — full narrative for the most recent work: root causes, fixes, ADRs, inflection points, blind spots, lessons.
3. **`CLAUDE.md`** — master infrastructure spec, deployment coordinates, and the ADR ledger (§3 — backfilled 2026-07-07, was stale for weeks).
4. **`.memory/ADRS.md`** — the append-only architectural decision log (mandatory per `AGENTS.md` — write an entry here before any cost/logic/architecture decision).
5. **`.memory/AGENT_LEDGER.md`** — the shared concurrency ledger. Read before touching any file; append `[IN_PROGRESS]`/`[DONE]` per the protocol in `CLAUDE.md` §2. **Caveat learned 2026-07-07**: a `[DONE]` entry here is not permanent proof the described code still exists — a later refactor can silently drop earlier work (confirmed case: a 2026-06-19 entry claims a `TimestampLink` component was built and wired in; it does not exist in the current codebase). Verify against the actual file before trusting an old ledger claim.
6. **`.memory/lessons.md`** — accumulated lessons. Lessons 1-8 are from the 2026-05-12-era Cloudflare-consolidation work (historically accurate for that era, not current-state claims). Lessons 9-12 (2026-07-07) are current.

## Standing rules that are still live (verified 2026-07-07)

- **Package manager**: `pnpm` only.
- **qa-intel** (`scripts/verify-quality-engine.ts`) must be run from the **repo root**, not `web/` — fails with `ERR_MODULE_NOT_FOUND` otherwise. CI blocks on HIGH severity only.
- **`CHAT_PROTOCOL`** (`web/lib/config/prompts.ts`) is the single source of truth for the chat's system prompt — it's bundled into the Cloudflare Worker by esbuild, there is no separate worker-side copy to sync.
- **Service-client routes** (`getSupabaseServiceClient()`) get zero protection from Postgres RLS by design — every such route needs its own explicit ownership check in code. One IDOR from a missing check was fixed 2026-07-07 (ADR 009); a repo-wide sweep for the same pattern elsewhere is still open (task #64).

Do not add narrative status content back into this file — that belongs in `project_status.md`. Keep this one a short index.
