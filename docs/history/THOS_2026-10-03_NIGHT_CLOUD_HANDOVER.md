# THOS — 2026-10-03 night: cloud handover (no OC/AGY until Tue 2026-10-06 02:00)

**Read first.** Previous: `docs/history/THOS_2026-10-03_PM_SCHEMA_PROVENANCE_ADR036-038_DNA_HANDOVER.md`.
**Who reads this:** a Claude Code **cloud** session (claude.ai/code) on this repo. The user's local CC limit is reset Tuesday 2026-10-06 02:00; until then they work only in the cloud.

## 0. Cloud-session ground rules (differs from every earlier handover)

- **No OC, no AGY, no local tools.** They are processes on the user's machine. The CLAUDE.md delegation rules (dispatch to OC/AGY, two-strike watch) **cannot apply**: the cloud session does the work itself. Still use `docs/agent-prompts/TEMPLATE.md` discipline for your own work (ledger entry, gates, negative controls, report format).
- **Nothing in `/tmp/opencode/` exists in the cloud.** The two POC inputs that mattered are now committed under `scripts/bakeoff-inputs/` (PR #428): `pool_classification.json`, `articulation-exercise.mts`.
- **Transcripts are NOT committed** (ADR 012: 72 h retention). Re-fetch the pool's transcripts through the worker: `POST https://yt-intel.hex-tech-lab.workers.dev/fetch-transcript` (`worker/src/routes/transcript.ts:17`; read it for the body shape) — needs the header `Origin: https://hex-yt-intel.vercel.app` (Python urllib gets 403; curl works — `docs/history/HANDOVER_2026-09-27-OC-BAKEOFF-PIPELINE-REENGINEERING.md:24`). Cache them in the session's own temp dir, never in git.
- **Secrets the cloud environment needs** (set in the claude.ai/code environment settings, never in chat or git): `OPENROUTER_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` for the bake-off; `gh` auth for PRs. Without them, Track B cannot run — say so and do docs/review work instead.
- **Supabase MCP / Vercel MCP** may or may not be connected in the cloud session; check before relying on them.

## 1. State at handover (all verified by CC 2026-10-03 22:40 EEST)

### 1.1 Merged today
| PR | Merge | What |
|---|---|---|
| #420 | `df81a5cc` | ADR 036 + 038: staged orchestrator prerequisite; preregistered per-arm go/no-go (§4b); failed gate ⇒ stay on Haiku; implementation waits for a pass |
| #417 | `25688c08` | Time-sync + segment provenance: only worker-fetched segments drive `[HH:MM:SS]` markers / persist |
| #426 | `a98679e4` | Route B: classification cell (dim 11) gets clean transcript; route-level v2 dimension-mismatch guard test. Merged with DeepSource JS (worker) red **by user decision** — main itself has been red on that analyzer since #417; #426 added no new DeepSource findings |

### 1.2 Open PRs
| PR | Head | State | Next action |
|---|---|---|---|
| **#421** ETA smoothing | `b50b5c86` | CC-verified (cutoff, ticker stop, new-run reset — each with a negative control), `/code-review` finding fixed, CI green | **Merge on the user's go** (they have not yet said go) |
| **#425** DNA Tenet 3 | `7ee9cf64` | User's exact wording in both DNA files; CI green | **Merge on the user's go** |
| **#424** infra (sample-run idempotency + deploy gate) | `5bb7ef3e` | CC took it over (OC two strikes). Verified: unique index on non-failed system runs, no delete; stale pending/sampling runs released after `comments.system.staleRunMinutes` (30); skip only at ≥ `comments.system.minUsableComments` (10, user directive); pre-deploy gate targets `--env production`, only CF error 10007 counts as first deploy. Full suite 2715, qa-intel clean, `/code-review` findings fixed. | **Merge on the user's go, then apply the migration** `supabase/migrations/20261003200000_system_sample_run_unique_per_analysis.sql` and **rename the file to the version Supabase records (ADR 018)**; run `pnpm exec supabase db push --dry-run`. If Supabase MCP isn't available in the cloud, CI's `supabase db push` (ADR 013) applies it on merge — then reconcile the filename in a follow-up. |
| **#427** Phase B design + S1–S6 taxonomy | `91f4e745` | Design doc (Vercel + QStash trigger, shared 0.90/0.70 gate bands — both user-decided), taxonomy v1 doc + `web/lib/jev/taxonomy.ts` + re-classification. **Not CC-reviewed: the taxonomy commit landed as the session ended.** | See §2.1 — blocking decision first |
| **#428** bake-off harness v3 (DRAFT) | `e7fddb53` | OC stopped mid-run for this handover. **Not CC-verified.** | See §2.2 |

### 1.3 Facts you must re-verify before acting (snapshots, not durable truth)
- Production routing: `app_settings.model_config.testOverride.enabled = true` → Haiku-first. Check live before any cascade work.
- DeepSource JS (worker) red on main since #417 (`25688c08`): findings unknown (dashboard needs login). Open item.

## 2. Next steps, in order

### 2.1 FIRST — S1–S6 taxonomy decision (needs the user)
The POC (2026-09-26/27) saved only per-video labels; its criteria wording was lost. The user approved a reconstructed v1 taxonomy. Re-classifying the pool with v1 (`docs/architecture/S1_S6_POOL_RECLASSIFICATION.json`, on #427):
- **Class agreement 4/12 (33%)**; 2 videos skipped (no cached transcript: Z6l4HpuyyP0, GOLgLU54b5s).
- v1 pushes multi-speaker videos to **S2** (which the POC never assigned): MoBr0nQtOnA, DlNWYzaL_F0, LTNVA2iP9YU S3→S2; _LCeJZFIsd4 S6→S2.
- **uZ5kJ9CBbv0 multiSpeaker 0.87 → 0.06** — a large drift on the same transcript; check whether the transcript or the criteria changed before trusting either run.
Ask the user: (a) refine v1 wording and re-run (cheap, ≈ $0.01), (b) accept v1 as the new ground truth and re-label the pool, or (c) something else. **Phase B classification cannot be built on a taxonomy that disagrees with its own validation set 2/3 of the time.** Review the taxonomy commit (`91f4e745`) for correctness yourself before presenting.

### 2.2 Track B — bake-off harness v3 (#428), then the paid run
User decisions (binding): **factual parity** = adherence to the transcript's truth (coverage minus unsupported claims; Haiku's historical inventions penalized); **style parity** = composition vs Haiku's prose (Haiku's own style = 100 by definition); report unsupported-claim rate. The 5 missing Haiku baselines (yB92mx97A8s, _LCeJZFIsd4, DlNWYzaL_F0, uZ5kJ9CBbv0, 39hqY3nH5ug) must use the **exact UCIS v5.4 prompt as of `c4125116`** (the prompt changed after it), generated in the harness — never today's production pipeline. **~$6 authorized; report the exact final cost.**
Verify #428 before any paid run:
1. Read OC's ledger entry + `scripts/bakeoff-v54-prompt-legacy.ts`: is it byte-identical to the prompt at `c4125116` (`git show c4125116:<path>` diff)?
2. Haiku is graded as an arm against the transcript with the same judge; the judge prompt penalizes unsupported claims for every arm.
3. GLM→OSS route matches `scripts/bakeoff-inputs/articulation-exercise.mts`.
4. `scripts/bakeoff-gate.ts` implements ADR 038 §4b exactly; `scripts/quality-engine/bakeoff-gate.test.ts` has a failing fixture per clause — break each clause and confirm the test fails (negative controls).
5. Finish OC's interrupted qa-intel fixes (it stopped on a single-letter-variable finding).
6. ADR 038 §4b "Score definitions" edit: confirm it says factual/style, dated, "before any R6 run".
7. Smoke spend so far: 3 runs on Z6l4HpuyyP0 ≈ $0.034 (debug reruns).
Then: fetch transcripts (§0), generate the 5 baselines (`--generate-baselines`), run all 14, report per-arm verdict + strata + exact cost as a published HTML page.

### 2.3 Phase B — design only until a route passes §4b
Design doc on #427 (`docs/architecture/DESIGN-036-phase-b-layer0-layer1.md`). Q1/Q2 decided; Q3 = §2.1. **No pipeline code** (ADR 038).

### 2.4 Tech debt logged today
- CodeFactor complex method `web/lib/jev/transcript-time-markers.ts:73` (#417 annotator).
- `upsertTranscript` probe-error path duplicates the upsert payload build (#417 fix) — simplify candidate.
- DeepSource JS (worker) red on main (§1.3).
- Usable-comments threshold: a video with < 10 total comments always qualifies for one system run (bounded to one per analysis).

## 3. Mandatory pipeline (unchanged, minus delegation)
Scope with code-review-graph (if available in the cloud) → change → qa-intel diff + full, `/simplify`, task-relevant skills → `/pr-review-workflow` → `/code-review` **exactly once** → merge only with the user's go. Negative control for every claimed fix. Reports as published HTML pages.

## 4. Last user messages (verbatim, abridged where marked)
1. "i need to continue this session on the cloud. how?"
2. "…while I'm running the cloud I will use CC cloud code completely in the cloud without any existing tools like AGY or OC so there will be no delegation but as far as the other elements are concerned how can we solve that? … I'm going to be timed out for 2 for 3 days … So I'm going to use the cloud until for the next 2 days and then come back here when my reset resumes on Tuesday at 2 a.m."
3. [S1–S6 + Phase B answers] "Approved: Use a QStash job." / "Approved: Reuse ADR 036's 0.90 / 0.70 bands." / "[S1–S6 taxonomy, six classes with actions] … codify it permanently into worker/src/services/jev-types.ts and docs/architecture/S1_S6_TAXONOMY.md" (CC put the type in `web/lib/jev/taxonomy.ts` — shared code, since Phase B runs on Vercel — and recorded the criteria as a reconstruction, not a copy; see §2.1.)
4. "Merge #426 now (Recommended)" (DeepSource question).
5. [Bake-off] "Upgrade harness, then run … FACTUAL Parity … strictly measures adherence to the transcript's truth … Generate the 5 missing Haiku baselines using the exact legacy UCIS v5.4 prompt … You are authorized for the ~$6 spend … Report the exact final cost." / "[Phase B] Design doc only … Strict adherence to ADR 038."
