# DISPATCH PROMPT: WAVE 7 - ALGORITHMIC SAMPLING & CUBIC P1 RESOLUTION

**To:** OpenCode (OC)
**Role:** Senior Systems & Protocol Engineer
**Model Standard:** `@preset/glm-53-flash-on-cheap` (Providers: `baseten`, `modal`. `allow_fallbacks: false`).
**Constraint:** Deliver SURGICAL unified diffs only. No speculative refactors. Time limit strict.

---

### Task 1: Layer 0 Proportional Transcript Sampling
**Target:** `web/lib/services/pipeline-router.ts`
**Objective:** Replace the fixed 24,000-character slice with a proportional sliding-scale sampling algorithm to strictly control token cost while capturing the entire video arc (intro, body, conclusion).
1. Compute a character budget: `Math.min(12000, Math.floor(transcript.length * 0.12))`. If the total transcript length is `<= budget`, use the entire transcript without truncation.
2. If `transcript.length > budget`:
   - Beginning slice: `Math.floor(budget * 0.60)` characters from the start.
   - Middle slice: `Math.floor(budget * 0.15)` characters centered around the midpoint of the transcript (`Math.floor((transcript.length - midLen) / 2)`).
   - Ending slice: remaining budget characters (`budget - startLen - midLen`) from the end (`transcript.length - endLen`).
   - Join with `\n...[TRUNCATED]...\n`.
3. Pass this sampled text to the GLM prompt, updating the system prompt text to state that the input is a sampled cross-section (intro/mid/outro) of the video transcript.

---

### Task 2: P1 Database RPC Crash & Status Desync
**Target:** `supabase/migrations/20260928100000_history_overview_function_v16_highlights_duration.sql`
**Objective:**
1. Fix the crashing `::int` cast on lines 138-139:
   Replace direct casts like `nullif(l.analysis_payload -> 'videoMetadata' ->> 'duration', '')::int` with a safe pattern using `substring(val from '^[0-9]+$')::int` (or regex matching digits only, clamped/safe) so decimals, non-numeric strings, or invalid JSON never crash the query, defaulting safely to `NULL`.
2. Fix status desync:
   Update the status calculation `CASE` expression on lines 105-112:
   ```sql
   case
     when l.billing_status = 'processing'
       and l.created_at > (now() - interval '15 minutes') then 'processing'
     when l.billing_status = 'processing' then 'stalled'
     when l.billing_status = 'completed' then 'complete'
     when cardinality(l.present_dims) >= 8 then 'partial'
     when (l.validation_report ->> 'status') = 'partial' or (l.validation_report ->> 'validation_status') = 'partial' then 'partial'
     else 'failed'
   end as status,
   ```
   Also update the `failure_reason` case on line 146 so that if the report status is `'partial'` it returns `null` (not surfacing a failure reason for a recoverable partial analysis).

---

### Task 3: P1 Safe Storage Read Preservation
**Target:** `web/lib/utils/safe-storage.ts`
**Objective:** Split read and write fallbacks.
1. When probing storage, test `getItem` first. If reading does not throw `SecurityError`, keep the underlying storage reference for reads.
2. Probe `setItem` / `removeItem`. If writing throws (e.g. `QuotaExceededError` or restricted write mode), do NOT discard read access to the underlying storage.
3. Overlay an in-memory `Map<string, string>` for writes:
   - `setItem(key, val)` writes to the in-memory map. Attempt to also persist to underlying storage if writable; if it throws, store in the in-memory map and log a warning.
   - `getItem(key)` checks the in-memory overlay map first. If not found, falls back to underlying storage `getItem`.
   - `removeItem(key)` deletes from the overlay map and attempts removal from underlying storage.
   - `clear()` clears both.

---

Output the complete, unified diffs for these 3 files.
