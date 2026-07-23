-- Wave P (2026-07-23 night session): extend the Vault-backed prompt registry
-- (table + RPC created in 20260723200000_prompt_vault_registry.sql, NOT
-- recreated here) with the next prompt migrated off a hardcoded TS constant.
--
-- User's directive (verbatim, restated by orchestrator): "extending the vault
-- reg. pattern to every prompt in the system. none should be hardcoded."
--
-- Scope of THIS migration: prompt.chat_grounding.instructions -- the static
-- instructional core of ProcessChatMessageUseCase's per-request chat
-- grounding prompt (web/lib/prompts/chat-grounding.ts). Only the invariant
-- instructional paragraph is migrated; the per-request video title/channel
-- prefix and the analysis/transcript/comments sections stay inline string
-- interpolation at the use site (they are request data, not prompt text).
--
-- Deliberately NOT in this migration (see Wave P report for full inventory):
--   - prompt.ucis_v5_1.system: the primary revenue-path analysis prompt.
--     Already has a MORE mature DB+Redis mechanism (app_settings.prompt_config
--     via web/lib/services/settings.ts resolveUCISPromptTemplate) with real
--     version history/rollback that Vault's single-secret-per-key model does
--     not yet replicate. Migrating it safely needs a version-aware Vault
--     layout (one secret per version, or re-pointing secret_id on publish)
--     designed and regression-tested against that existing mechanism first --
--     deferred, flagged to the orchestrator for a decision, not attempted here.
--   - worker/src/services/PromptBuilder.ts's inline segmented-analysis
--     instruction text: lives in a worker-only file (not cross-imported from
--     web/lib), so a runtime Vault fetch from inside the Workers isolate has
--     not been verified against the actual Workers runtime (no local CF
--     Workers runtime available to test against). Left hardcoded with a risk
--     note rather than blindly wired.
--   - web/lib/config/prompts.ts CHAT_PROTOCOL: confirmed dead code (zero
--     importers repo-wide, including tests) -- not an active prompt, so not
--     migrated. Flagged for a separate cleanup pass.

do $$
declare
  v_secret_id uuid;
begin
  if not exists (select 1 from public.prompt_definitions where key = 'prompt.chat_grounding.instructions') then
    v_secret_id := vault.create_secret(
      $vault$Your single source of truth is the structured analysis, video description, and transcript below — every fact, claim, quote, number, and detail you output must come from them, and you must never invent content or pull in outside knowledge about the topic. Within that boundary, the user's application is unrestricted: if they ask for a podcast script, blog or Medium post, social thread, newsletter, bullet summary, shopping list, step-by-step plan, or any other repurposed format, produce it fully and creatively using ONLY this video's material — do not refuse because the analysis "doesn't include" that format; formats are yours to create, facts are not. If a request needs facts the analysis genuinely does not contain, say what's missing rather than inventing it. Cite dimension names where relevant. Do not ask which video — you have it. When both the analysis and the transcript could answer a question, prefer the analysis for synthesis and interpretation, but always defer to the verbatim transcript for exact quotes, wording, or a specific timestamp. When the user asks for a time range (e.g. "minute 52", "the full minute 52", "51:00 to 52:00"), you MUST scan the ENTIRE transcript and quote EVERY line whose timestamp falls anywhere within that whole range, from its start to its end — never stop after the first one or two lines you find near the start of the range; a sparse-looking range (few lines of dialogue) is a real property of the source and should be reported as-is, not padded or truncated further.$vault$,
      'prompt.chat_grounding.instructions.v1',
      'Chat grounding instruction core (source-grounding + application-freedom rules, transcript-range scan directive). Migrated from web/lib/usecases/ProcessChatMessageUseCase.ts inline `grounding` template literal, 2026-07-23. Per-request title/channel prefix and analysis/transcript/comments sections remain inline at the call site.'
    );

    insert into public.prompt_definitions (key, secret_id, version, description, owner_role)
    values (
      'prompt.chat_grounding.instructions',
      v_secret_id,
      1,
      'Chat grounding instruction core. Source of truth as of 2026-07-23 -- edit via the settings/prompts admin surface, not by re-deploying code.',
      'admin'
    );
  end if;
end $$;
