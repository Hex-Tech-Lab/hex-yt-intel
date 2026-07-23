-- Wave D3 (new, 2026-07-23 night session): move LLM system prompts out of
-- source-code TS files into Supabase, using the ALREADY-INSTALLED
-- supabase_vault extension (verified via MCP list_extensions before writing
-- this migration -- v0.3.1, no new extension install needed) for
-- encryption-at-rest instead of a hand-rolled cipher.
--
-- User's directive (verbatim): "even all the prompts have to be based in sb
-- as part of system settings... hashed or something for safeguarding the
-- secret sauce but they have to reside inside sb tables and possibly in
-- redis as well." Decision on protection mechanism (same session): RLS-only
-- was the baseline ask, WITH encryption-at-rest if it's trivial to add
-- without complexity/regression risk. Vault meets that bar exactly -- it's
-- Supabase's own purpose-built secret-storage extension (pgsodium under the
-- hood), transparent encrypt-on-write / decrypt-on-read via
-- vault.create_secret()/vault.decrypted_secrets, service-role-only by
-- Supabase's own design (no RLS policy to hand-write and get wrong).
--
-- Scope of this migration: the table/registry pattern + the FIRST prompt
-- migrated (executive-digest's EXECUTIVE_DIGEST_SYSTEM, the smallest and
-- lowest-blast-radius prompt -- Vercel-only consumer, no worker forwarding
-- needed). The larger UCIS v5.1 system prompt (worker-consumed, the actual
-- "secret sauce" analysis prompt) is intentionally NOT migrated in this pass
-- -- it needs the same Vercel-resolves/worker-receives-via-signed-payload
-- forwarding built for chat.comments.* (see 20260723190000) plus a live
-- regression test before being trusted with the primary revenue path.
-- Redis caching layer: not yet added -- the in-process TTL cache pattern
-- (SupabasePromptAdapter, mirroring SupabaseSettingsAdapter.getRegistrySettings)
-- is the first cache tier; Upstash Redis as a second tier is a follow-up if
-- the in-process cache proves insufficient (worker isolates are short-lived
-- so cross-instance caching may matter more than it does for Vercel).

-- ============================================================================
-- 1. prompt_definitions: catalog + pointer into vault.secrets
-- ============================================================================
create table if not exists public.prompt_definitions (
  key           text primary key,
  -- Points at vault.secrets.id -- the actual prompt TEXT lives encrypted in
  -- Vault, never in a plain column here.
  secret_id     uuid not null,
  version       integer not null default 1,
  description   text not null,
  owner_role    text not null default 'admin' check (owner_role in ('user', 'admin', 'moderator', 'system')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.prompt_definitions is
  'Catalog of LLM system prompts. Actual prompt text is stored encrypted in Vault (vault.secrets via secret_id), never in a plain column -- read back only through vault.decrypted_secrets, which is service-role-only by Supabase''s own design.';

-- ============================================================================
-- 2. RLS -- table itself has no plaintext to protect, but access to WHICH
--    prompts exist and their vault pointers should still be service-role only
--    (the decrypted content is separately gated by vault.decrypted_secrets).
-- ============================================================================
alter table public.prompt_definitions enable row level security;

do $$
begin
  create policy "Only service role can read prompt definitions"
    on public.prompt_definitions
    for select
    using (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "Only service role can write prompt definitions"
    on public.prompt_definitions
    for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- 3. Seed: the first migrated prompt (executive-digest system prompt)
-- ============================================================================
do $$
declare
  v_secret_id uuid;
begin
  -- Idempotent: skip entirely if already seeded (re-running this migration
  -- must never create a duplicate vault secret).
  if not exists (select 1 from public.prompt_definitions where key = 'prompt.executive_digest.system') then
    v_secret_id := vault.create_secret(
      $vault$You are a precision executive-summarizer. Your only input is a completed 11-dimension intelligence analysis of a single YouTube video. Produce a four-tier executive digest OF THAT ANALYSIS. You are compressing already-distilled material — surface the signal, invent nothing.

HARD RULES
- Synthesize ONLY from the provided analysis. Introduce no facts, numbers, names, dates, or claims that are not present in it.
- No preamble, no meta ("In this summary…"), and no headings beyond the four specified below.
- Neutral, information-dense, plain language. Cut hedging and filler.
- If forced to drop something, keep the single most consequential takeaway.
- Never mention "dimensions", "the analysis", or the pipeline — write about the VIDEO'S CONTENT.

OUTPUT — emit exactly these four sections, in order, and nothing else:

#### 0.1 Snapshot
One paragraph, 3–5 lines. What the video is, its core thesis, and why it matters — for someone who will never watch it. This tier alone must convey the gist.

#### 0.2 Overview
1–2 paragraphs. A quick high-level summary of the main points. It sits between the one-liner snapshot and the key takeaways.

#### 0.3 Key Takeaways
Up to 10 bullets ("- " each), ranked most→least important. Each ≤ 20 words, one concrete idea, no sub-bullets. Prefer specifics (a tactic, a number, a claim) over generalities. Assess the content and use fewer than 10 bullets if appropriate to avoid unnecessary crowding.

#### 0.4 Detailed Summary
3–5 paragraphs. The full arc: context → main arguments & evidence → conclusions / implications. Faithful to the source's structure and emphasis; add no new interpretation.$vault$,
      'prompt.executive_digest.system.v1',
      'UCIS Dimension-0 executive digest system prompt (4-tier: Snapshot/Overview/Key Takeaways/Detailed Summary). Migrated from web/lib/prompts/executive-digest.ts EXECUTIVE_DIGEST_SYSTEM, 2026-07-23.'
    );

    insert into public.prompt_definitions (key, secret_id, version, description, owner_role)
    values (
      'prompt.executive_digest.system',
      v_secret_id,
      1,
      'Dimension-0 executive digest system prompt. Source of truth as of 2026-07-23 -- edit via the settings/prompts admin surface, not by re-deploying code.',
      'admin'
    );
  end if;
end $$;

-- ============================================================================
-- 4. RPC accessor -- Supabase deliberately does NOT expose the `vault` schema
--    over PostgREST (decrypted_secrets is sensitive by design), so a direct
--    `.schema('vault').from('decrypted_secrets')` REST call would fail. The
--    documented pattern is a SECURITY DEFINER function in an exposed schema
--    that reads vault internally and returns only the decrypted value, with
--    execution locked to service_role -- never anon/authenticated.
-- ============================================================================
create or replace function public.get_prompt_secret(p_key text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_value text;
begin
  select secret_id into v_secret_id from public.prompt_definitions where key = p_key;
  if v_secret_id is null then
    return null;
  end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where id = v_secret_id;
  return v_value;
end;
$$;

revoke all on function public.get_prompt_secret(text) from public, anon, authenticated;
grant execute on function public.get_prompt_secret(text) to service_role;
