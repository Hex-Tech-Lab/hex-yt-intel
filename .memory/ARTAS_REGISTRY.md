# ARTAS v4 — Autonomous Red Team Audit System: 32-Vector Interrogation Registry

**Status:** canonical (v3 2026-10-08; v4 2026-10-11 adds Domains 6–7, V24–V32, from a harvest of 437 review findings across yt-intel PRs #436–#462 and hex-expan-press PRs #70–#99). Read this before any PR review, red-team audit or
quality-gate verification. Every vector is a *question to break the code with*, not a
syntax check. An audit cites findings as `V<nn>` from this file.

**Numbering note:** hex-expan's earlier ARTAS v3 sweep (THOS 2026-10-05, PRs 35–65) used
ad-hoc IDs (its "V22" was a consent gap, "V01" a temp-file symlink write, "V04" a
query-param path build). Those map here to V15/V17 (consent/authorization), V12 (implicit
infra / filesystem trust) and V10/V12 (untrusted path input). From now on use this table's
numbers in both repos.

**How to apply a vector:** (1) find every place in the diff where the vector's *trigger*
occurs; (2) ask the *break question*; (3) a finding needs a concrete input/state → wrong
outcome, cited by file:line. "Could be risky" is not a finding.

**Static enforcement:** vectors marked **[QE]** have a QualityEngine rule in
`scripts/quality-engine/rules/artas-v3.ts`. All others are review-only.

---

## Domain 1 — State & Protocol

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V01 | Fail-Closed | Any guard, env check, config read, validation | When the input is missing, malformed, or the dependency errors, does it **deny**? Or does an exception/empty value fall through to the permissive branch? | Worker `NODE_ENV !== 'production'` was always true on Workers → dev HMAC fallback + localhost trust live in prod (env-utils.ts; ADR 041) |
| V02 | HTTP Lifecycle | Route handlers, streaming responses, `fetch` callers | Is every response returned exactly once, with correct status, headers (incl. CORS on error paths) and body — including after a throw mid-stream? | Uncaught worker 500 shipped without CORS headers → opaque "Failed to fetch" (2026-10-06) |
| V03 | Idempotency | Webhooks, queue consumers, finalize/persist endpoints, billing writes | If this exact request arrives twice (redelivery, retry, double-click), is the second a no-op? Is the dedupe key durable and checked atomically with the write? | Paddle webhook redelivery / out-of-order events |
| V04 | Concurrency | Check-then-act, read-modify-write on rows/JSON/Redis | Can two actors interleave between the read and the write (TOCTOU)? Is there a lock, conditional update, or atomic RPC? | PaddleBillingAdapter TOCTOU (2026-09-05 audit) |
| V05 | Fail-Open Undefined **[QE]** | Query builders / filters taking a variable (`.eq(col, x)`, `where`, `in`) | If the variable is `undefined`/`null`/`''`, does the filter vanish or match everything instead of matching nothing? | `get_temporal_subgraph` inferred service-role from `auth.uid() IS NULL` (fail-open IDOR) |
| V06 | Graph Integrity | Knowledge-graph / relational writes, merges, dedupe | Can a write create dangling edges, duplicate canonical nodes, or orphan children when one half of a multi-table write fails? | `kg_relations` empty DB-wide; KG gaps (ADR 023) |

## Domain 2 — External Integrations

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V07 | API Reality | Any third-party API call (OpenRouter, YouTube, Paddle, Supabase MCP, TranscriptAPI) | Does the code match the provider's **actual** current behaviour (verified against docs or a live call), not a remembered one — status codes, field names, limits, pagination? | Stale "90 s Worker limit" (CLAUDE.md Law #2); `apply_migration` version drift (ADR 018) |
| V08 | State Finality | Status fields (`processing`/`complete`/`failed`), billing state, jobs | Can a terminal state be overwritten by a late/stale event, or a non-terminal state be stuck forever with no reaper? | Stuck `processing` rows (ADR 007 reaper) |
| V09 | Phantom Data | Values derived from provider responses, LLM output, caches | Can the system persist or display data that the source never actually returned (defaults masquerading as real values, hallucinated IDs, empty-but-"success")? | Bound-but-EMPTY TranscriptAPI secret looked "configured" (2026-10-03) |

## Domain 3 — Security & Infrastructure

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V10 | SSRF Exhaustion **[QE: `.arrayBuffer()` only; `.text()`/`.json()` are review-only]** | Fetching user-influenced URLs; reading response bodies | Can an attacker point it at an internal/metadata host, or a huge/endless body that is buffered whole (`.arrayBuffer()`, `.text()`, `.json()`) without a byte cap? | hex-expan ExpanPress `arrayBuffer` bypass |
| V11 | Credential Leakage | Logs, Sentry extras, error bodies, client bundles, URLs | Can a secret, token, signed URL or PII reach a log line, error response, client chunk or query string? | Sensitive vars pulled empty via `vercel env pull` |
| V12 | Implicit Infra | Code relying on env/region/filesystem/runtime assumptions | What unstated platform assumption must hold (env var set, region, writable FS, Node vs Edge API, cron registered) — and what happens when it doesn't? | `APP_URL` stale in wrangler; hex-expan predictable `.tmp-${pid}` atomic write |
| V13 | IPv6 Bracket Bypass | Host/IP allowlists, SSRF guards, origin checks | Do `[::1]`, `[::ffff:127.0.0.1]`, `fe80::/10`, `0.0.0.0/8`, decimal/octal IPv4 evade the check? Is the check on the parsed host, not the string? | hex-expan PR82: fe80::/10 full range, 0.0.0.0/8 |
| V14 | DNS-Rebinding | Validate-then-fetch of hostnames | Is the IP validated the same IP that is dialled, or can DNS change between check and connect (TOCTOU)? | hex-expan sprint 13: pinned undici dispatcher (ADR-0058) |

## Domain 4 — Auth & Boundaries

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V15 | Quarantine-before-Auth | Any handler doing work before authN/authZ | Does it parse, fetch, write, enqueue or spend (LLM/quota) **before** proving identity and ownership? | Chat grounding gate (ADR 008); hex-expan consent gap on checkout |
| V16 | toLowerCase Bomb | Case/Unicode normalisation in comparisons (emails, origins, slugs, IDs) | Do both sides normalise identically? Can Unicode case folding (`İ`, `ß`, fullwidth) or mixed case bypass an allowlist or collide two identities? | Origin allowlist compares lower-cased origin vs literal list |
| V17 | Privilege Escalation | Role checks, `SECURITY DEFINER` functions, service-role clients, admin routes | Can a lower role reach a higher-privilege path (missing `REVOKE EXECUTE`, role inferred instead of checked, service-role client used for a user request)? | `get_temporal_subgraph` fail-open IDOR; ADR 009 ownership binding |
| V18 | Refactor Escapes | Moved/renamed/split code, duplicated allowlists | Did a guard, test, or call site get left behind when code moved? Are there now two copies of a rule that drift? | CORS allowlist duplicated → getvintel.com drift (PR #244 P0) |
| V19 | Idempotent Retry **[QE]** | Generic retry/backoff wrappers around `fetch` | Does the wrapper retry non-idempotent methods (POST/PUT/PATCH/DELETE) and so replay mutations? It must gate on `GET`/`HEAD` (or an idempotency key). | hex-expan skew-retry-fetch replaying mutations (ADR-0059) |

## Domain 5 — Edge-Case Network

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V20 | Unconsumed Stream Leak **[QE]** | `fetch` wrappers with early return/throw on `!res.ok` or status checks | On the early-exit path, is the body cancelled (`res.body?.cancel()`) or drained, or does the connection/socket leak? | hex-expan fetch wrappers |
| V21 | Asset Finality | Uploaded/generated assets, R2/Storage objects, TTL'd data | Is every asset deleted/expired when its owner is, and never served after its retention window (72 h transcripts, 24 h R2 probes)? | ADR 012 retention; ADR 039 R2 24 h TTL |
| V22 | Loop-Escape Rejection | Polling loops, retry loops, reapers, recursive stitching | Does every loop have a hard bound and an exit on abort/terminal state, and does rejection inside the loop escape it rather than spin? | Highlights polling abort/restart storm (PR #442) |
| V23 | Append-Only Violation | Ledgers, audit logs, validation reports, history tables, JSONB merges | Can a write **replace** what must only be appended/merged (overwrite a report, rewrite history, drop prior keys)? | `/api/webhooks/validate` replaced `validation_report`, wiping `jev_partial_dimensions` (2026-10-03) |

---

## Domain 6 — Client Lifecycle & Detection

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V24 | Detector Evasion | Text/regex-matching rules, guards, scanners, allowlists | Can a comment, different case, extra whitespace or a newline make the matcher miss a real hit, or a comment produce a false hit? Is matching done on code with comments stripped? | PR #460 security-lessons rules: 13 threads (case, `\s+`, comment evasion, basename over-exemption); 23 harvest hits |
| V25 | Remount State Loss | React `key`, mount-only props (`defaultSize`, `defaultLayout`, `defaultValue`), shared DOM mutations | Does a key change or a mount-only prop discard state that was restored or saved, or does a layout effect run after paint and overwrite it? | Dashboard panels (#455/#456/#461): pixel-read defaults, `key={shape}` remount dropped saved sizes, reset lost after shape switch; 14 hits |
| V26 | Non-Credential Private Data | Tracked files in a public repo | Does a tracked file expose business IP (COGS, pricing, prompts, research corpus, agent prompts) that credential scanners do not look for? | #351/#462 pricing + research corpus on public main; `rewrite.py` COGS text |
| V27 | Retry Outlives Cache | Retry/remediation schedulers calling cached LLM prompts | Is the first retry delay longer than the provider prompt-cache TTL, so every retry pays full input price? | Remediation 5-min cron vs Anthropic 5-min ephemeral cache; Recall run remediated at +6 min (2026-10-11) |
| V28 | Accessibility Semantics | Interactive widgets, toasts, live regions, colour tokens | Is it keyboard operable, announced exactly once, correctly roled (list/region/live), and ≥ 4.5:1 contrast? | hex-expan #82 triple announcement, #92 contrast 3.24:1; yt-intel #442 keyboard traps; 9 hits |

## Domain 7 — Process, Evidence & Accounting

| ID | Vector | Trigger | Break question | Known incident |
|---|---|---|---|---|
| V29 | Claim / Evidence Drift | ADRs, ledgers, PR bodies, audit reports, code comments | Does the doc claim more than the code or tests prove (a gate "passed" that never ran, a file list that is incomplete, a mechanism described that does not exist)? | 14 hex-expan findings (#85–#98); ADR 021 Phase-1 mechanism correction; CLAUDE.md "90 s limit" |
| V30 | Gate Integrity | CI baselines, qa-intel baselines, typecheck, merge scripts | Can a change merge with a type error, a refreshed baseline that whitelists real findings, or a gate run in the wrong mode/cwd that silently disables a rule? | #442/#443 type-check breaks (8); #446 baseline drift; lessons-20261009 rule disabled when run outside repo root (fixed 2026-10-11) |
| V31 | Partial-Failure Accounting | Multi-step pipelines with spend, quotas, metrics | When one step fails, is spend/quota/metric still recorded exactly once, and does one failure starve or double-count the others? | #442 budget starvation, metric double-count, spend on partial failure |
| V32 | Prompt Contract | LLM prompts vs the parser/schema that consumes their output; untrusted text inside prompts | Does the prompt promise a shape the parser does not accept (or vice versa), and can transcript/comment text steer the prompt? | #442 prompt-contract mismatch (3); #446 prompt-injection boundary; dimension repetition loop (2026-10-11 RCA) |

## v4 harvest coverage (2026-10-11)
437 findings: V09 52, V01 42, V12 31, V18 26, V24 23, V07 22, V23 17, V04 17, V29 15+, V25 14, V02 14, V03 12, V11 10, V13 10, V30 10, V08 8, V22 8, V28 9, V06 6, V15 6, V19 6, V17 5, V26 5, V31 6, V32 4, V10 3, V05 2, V20 2, V14 2, V21 1; 12 rows untitled (CodeRabbit bodies). Fixed status: 228 yes, 162 unknown, 47 no. Raw harvest (with exploit reasoning) is kept in the private companion repo: `docs/private/reviews/artas/harvest-2026-10-11/`.

## Audit output contract

`| PR # | Priority [P1/P2/P3] | ARTAS Vector Class | Target File | Vulnerability / Impact | Proposed AI Prompt / Remediation |`

- **P1** — exploitable or data-corrupting on current `main` with a concrete input.
- **P2** — real defect, needs unusual state or has limited blast radius.
- **P3** — hardening / latent risk.
- Every row must say whether it is **LATENT** (still present on current `phase-c`, checked by file:line) or **FIXED-LATER** (cite the fixing commit/PR). Refuted candidates are listed separately with the disproving line.
