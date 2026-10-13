-- T4 key takeaways redesign (2026-10-13). Bumps two live prompts:
--   * prompt.executive_digest.system  v2 -> v3  (full v3 text; only section 0.3 differs from v2 --
--     keep in sync with web/lib/prompts/fallbacks/executive-digest.fallback.ts;
--     cap 3-12 bullets, aim 5-9, fused quotable stances, ranked by weight)
--   * prompt.chat_grounding.instructions v10 -> v11  (appends a KEY TAKEAWAYS
--     TABLE rule mirroring the digest's takeaways, timestamp ranges per element)
-- Both are guarded on the current live version, mirroring the v9 resync pattern.
-- NOT applied to the DB by the implementing agent: CI applies migrations on
-- main only (ADR 013/018), not on uat. Promotion to main applies this file.

do $$
declare
  v_secret_id uuid;
  v_chat_text text;
begin
  if exists (select 1 from public.prompt_definitions where key = 'prompt.executive_digest.system' and version = 2) then
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
1–3 lines. What the video is, its core thesis, and why it matters — for someone who will never watch it. This tier alone must convey the gist.

#### 0.2 Overview
4–6 lines. A quick high-level summary of the main points. It sits between the one-liner snapshot and the key takeaways.

#### 0.3 Key Takeaways
3–12 bullets ("- " each; aim for 5–9), ranked most→least important by weight. Group related points: each bullet is one sharp, quotable, declarative stance that fuses 2–3 related points and keeps the speaker's own positioning (their thesis, contrarian claims, defining phrases), anchored by a concrete specific (a tactic, a number, a claim). Each ≤ 30 words. No sub-bullets, no labels. Never pad to reach a count; never exceed 12.

#### 0.4 Detailed Summary
3–5 paragraphs. The full arc: context → main arguments & evidence → conclusions / implications. Faithful to the source's structure and emphasis; add no new interpretation.$vault$,
      'prompt.executive_digest.system.v3',
      'Executive digest system prompt, v3 (2026-10-13, T4): Key Takeaways redesign. 0.3 now 3-12 bullets (aim 5-9), each a fused quotable stance keeping the speaker positioning, ranked by weight, <=30 words. Replaces v2 (fixed cap of 10, <=20 words, one idea per bullet).'
    );

    update public.prompt_definitions
    set secret_id = v_secret_id,
        version = 3,
        description = 'Executive digest system prompt, v3. Source of truth as of 2026-10-13 -- edit via the settings/prompts admin surface, not by re-deploying code.',
        updated_at = now()
    where key = 'prompt.executive_digest.system'
      and version = 2;
  end if;

  -- Chat grounding: append the KEY TAKEAWAYS TABLE rule to the live v10 text.
  -- The v10 text is read from Vault at migration time so it is not copied here.
  if exists (select 1 from public.prompt_definitions where key = 'prompt.chat_grounding.instructions' and version = 10) then
    select s.decrypted_secret || E'\n\n' || $add$KEY TAKEAWAYS TABLE: when the user asks for key takeaways (or asks for the key points as a list), answer with the same takeaways (mirroring the digest's Key Takeaways in substance and order) as a table with header `| Timestamp | Takeaway |`, one row per takeaway and the same count. A Timestamp cell may hold several from–to ranges separated by ", ", one per element or repetition of that point in the video, listing the clearest or most powerful rendition first, not merely the first occurrence. Use the same range format as the general rule and never a second citation style.$add$
      into v_chat_text
      from public.prompt_definitions d
      join vault.decrypted_secrets s on s.id = d.secret_id
     where d.key = 'prompt.chat_grounding.instructions' and d.version = 10;

    v_secret_id := vault.create_secret(
      v_chat_text,
      'prompt.chat_grounding.instructions.v11',
      'Chat grounding instruction core, v11 (2026-10-13, T4): appends a KEY TAKEAWAYS TABLE rule so key-takeaway answers mirror the digest Key Takeaways in substance and order, with timestamp ranges per element. Layered on v10.'
    );

    update public.prompt_definitions
    set secret_id = v_secret_id,
        version = 11,
        description = 'Chat grounding instruction core, v11. Source of truth as of 2026-10-13 -- edit via the settings/prompts admin surface, not by re-deploying code.',
        updated_at = now()
    where key = 'prompt.chat_grounding.instructions'
      and version = 10;
  end if;
end $$;
