-- Defense in depth (CodeRabbit audit): a message write must target a conversation the
-- caller owns, not merely carry the caller's user_id — otherwise a direct PostgREST
-- call could inject rows into another user's thread. Re-create the policy with an
-- ownership EXISTS check in WITH CHECK.
drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
  for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );
