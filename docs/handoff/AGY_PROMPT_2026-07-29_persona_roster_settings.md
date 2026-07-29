# AGY Dispatch — Persona Roster in Settings (scoped, not full N-dynamism)

Standing rules apply: read `.memory/AGENT_LEDGER.md` first, log progress, verify against live data, qa-intel + typecheck + build before "done".

## Context

The 5 UCIS personas (Creator, Indie Maker, Consultant, Researcher, Product Manager) are currently hardcoded in three places:
- `web/lib/prompts.ts` — `PERSONA_REGISTRY` (id -> display name) and `rankPersonas()` (hardcoded 50/25/15/5/5 weight literals, exactly 5 array slots).
- `web/lib/prompts/ucis-v5.1.ts` — Dimension 11.5/11.7 hand-authored prose per persona, and the JSON output schema's `monetizationVerdict` object with fixed keys (`creator`, `indieMaker`, `consultant`, `researcher`, `productManager`).
- `web/lib/config/synthesis.ts`, `stream-delta-handler.ts`, `stitch-analysis-chunks.ts`, various components/adapters/tests — persona IDs used as literal object keys throughout.

User's explicit decision (2026-07-29): do NOT build full N-persona dynamism right now — that requires the prompt's Dimension 11 prose and JSON schema to be auto-generated per configured persona, and every downstream consumer to become schema-agnostic. Real project, correctly deferred. Scope for THIS task is narrower:

## Scope: externalize the roster, keep prompt/schema authored

1. **New settings table** (follow the pattern of `settings_registry`/`admin_settings_page_access_matrix` migrations, check those first): `persona_roster` or similar, storing `{id, displayName, weight, sortOrder, active}` for the current 5 personas, seeded with today's exact values (50/25/15/5/5, same IDs). This becomes the single source of truth for "which personas exist and their weights" — `PERSONA_REGISTRY`/`rankPersonas()` read from it (with the existing in-process/Redis cache tiers, matching `readPromptConfig()`'s pattern) instead of hardcoding.

2. **Admin UI**: a Settings page section (new tab under Settings, or extend an existing persona-adjacent one) to view/edit the roster — rename a persona, adjust weight, toggle active. **Do NOT let this UI silently change persona COUNT** (add/remove a row) without a hard guardrail: require typing the persona's exact name to confirm removal (same pattern as Vercel's "type the project name to delete"), and on ANY roster change, surface a blocking warning that the Dimension 11 prompt prose in `ucis-v5.1.ts` and the JSON schema were NOT auto-updated and must be manually reviewed/edited by a human before the change takes effect for new analyses — otherwise a roster edit could silently desync from the actual prompt content the same way today's bug happened.

3. **Do NOT** attempt to auto-generate Dimension 11 prose or the JSON schema from the roster in this pass. The prompt template stays manually authored in `ucis-v5.1.ts`; the roster settings table is metadata/display config only (used for `rankPersonas()`'s weight ordering and any UI that lists personas), not a code generator.

4. **Verification required**: after wiring `rankPersonas()` to read from the new table, run a real synthesis end-to-end and confirm the Persona Configuration header and weight percentages in the output still match today's exact values (regression check — this must be a no-op change in current behavior, only a storage-location change).

## Explicitly out of scope for this task

- Auto-generating prompt sections per persona.
- Making the JSON schema's `monetizationVerdict` (or any persona-keyed structure) dynamic/schema-agnostic.
- Historical-analysis compatibility versioning for roster changes.
- Actually changing the persona count/roster (this task only builds the mechanism; whether to ever use it to go from 5 to N personas is a separate future decision).
