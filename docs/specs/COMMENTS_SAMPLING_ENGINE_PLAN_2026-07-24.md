# Comments Multi-Stage Sampling Engine — Implementation Plan (2026-07-24)

## Root cause of the SOTU under-sampling bug
`worker/src/services/MetadataScraper.ts:fetchComments()` makes a single `commentThreads.list`
call capped at `maxResults=20`, no `nextPageToken` pagination, no stratification. Not "a sample" —
a flat 20-comment relevance-ordered page, silently. No tier concept exists anywhere in the code today.

## Key existing patterns to reuse (do not reinvent)
- **Settings Registry**: `setting_definitions`/`setting_values`, `SupabaseSettingsAdapter.getRegistrySettings()`
  (60s cache, fallback-on-DB-failure). Every tunable below (percentages, batch size, Cochran params,
  credit price) is a registry row, never a hardcoded constant.
- **Cascade pattern**: `CHAT_CASCADE` in `web/lib/config/cascade.ts` already puts Groq GPT-OSS-120b
  first — the batched comment-classification calls ride this, not a new provider mechanism.
- **No credit/metering system exists yet** — only monthly quota gating (`free`/`pro` tier) +
  `usage_logs.cost_usd`. Tier 3 needs new schema.
- **No queue/background-job infra exists** — only Redis SSE streaming. Tier 3's uncapped fetch
  needs new async infra (Cloudflare Queue, Durable Object, or cron poller).

## Phases
0. **Sampling module** (`web/lib/services/comment-sampling.ts`, pure/testable): Cochran's formula
   w/ finite-population correction, tier→percent resolution, stratified-index selection.
1. **DB migrations**: registry keys (`comments.sampling.*`, `comments.cochran.*`, `comments.batch.*`,
   `comments.credit.*`) + new tables `comment_sample_runs`, `comment_classifications`, and a Tier-3
   credit table (shape depends on open question #4 below).
2. **Ports**: `CommentSamplingPort`, extend `MetadataIngestionPort` for paginated fetch,
   `CommentClassificationPort` (worker-side, mirrors `LLMCascadePort`).
3. **Tiers 0–2 flow** (synchronous): paginate up to sample target, stratify from fetched pool
   (YouTube API has no server-side stratified sampling), auto-expand on insufficient signal
   (bounded, registry-capped attempts), persist to `comment_sample_runs` for audit.
4. **Tier 3 flow** (new async infra required): pre-commit `/api/comments/estimate` route, queued
   job, actual-vs-estimate reconciliation on completion.
5. **Batched classification**: `worker/src/services/CommentClassifier.ts`, batches of
   `comments.batch.classificationBatchSize`, rides `CHAT_CASCADE`.
6. **UI**: tier selector + live "X% of Y = Z sampled" readout, Tier 3 pre-commit credit estimate
   modal, surface `comment_sample_runs` in analysis UI so under-sampling is self-explanatory.

Full agent output (call sites, migration sketch, exact schema drafts) in session transcript;
critical files: `MetadataScraper.ts`, `worker/src/routes/analysis.ts`, `CreateAnalysisUseCase.ts`,
`SupabaseSettingsAdapter.ts`, `SupabaseBillingAdapter.ts`, `cascade.ts`,
`20260723190000_comments_fetch_settings.sql`, `contracts.ts`.

## Decisions (2026-07-24, user-confirmed)
4. **Tier 3 credit model**: real prepaid wallet/ledger (user tops up, analyses draw down). Needs
   `credit_ledger`/`credit_balances` tables, not a per-analysis Stripe charge.
5. **Reconciliation**: charge actual, capped at estimate (user never pays more than approved) —
   PLUS every reconciliation event (estimated vs. actual delta) logs to a new
   `estimate_reconciliation_log` table. The estimate formula's parameters live in the Settings
   Registry as a versioned key (e.g. `comments.credit.estimate_params_v1`); systematic drift in
   the log surfaces for a human to approve a parameter-version bump — self-healing means
   *flagging* the correction for approval, not silently auto-mutating pricing. Every version bump
   is itself a DB record (audit trail), matching the registry's existing versioned-row convention.
6. **Async infra**: Cloudflare Queue (fits ADR 005's edge architecture, no new platform dependency).
7. **Tier axis**: separate from `users.tier` (free/pro) — sampling tier is a per-analysis choice
   available to any subscription tier; Tier 3 is metered via the credit ledger regardless of
   subscription.

1. **Stratification**: two-dimensional — like-count buckets x recency buckets. Chosen over
   single-dimension because YouTube comment signal clusters on both engagement and posting time;
   registry keys `comments.sampling.likeBuckets`/`comments.sampling.recencyBuckets` (counts, not
   hardcoded bucket boundaries).
2. **Auto-expand trigger**: min absolute sample-size floor (registry key
   `comments.sampling.minSignalCount`, e.g. default 50) — chosen over SE/entropy checks to avoid a
   circular dependency where auto-expand would need Phase 5's classifier to run first.
3. **Cochran's formula**: `p=0.5`, `e=0.05`, `z=1.96` (95% CI) — pinned as registry defaults
   `comments.cochran.pEstimate`/`marginOfError`/`zScore`; this is what produced the ~30% figure.

## All product/statistical decisions closed — ready for Phase 0 implementation.
