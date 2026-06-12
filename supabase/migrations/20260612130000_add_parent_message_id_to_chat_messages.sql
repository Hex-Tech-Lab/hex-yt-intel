-- Migration: Add parent_message_id to chat_messages to establish turn relations
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS parent_message_id uuid REFERENCES public.chat_messages(id) ON DELETE CASCADE;

-- Index to optimize parent-message lookups
CREATE INDEX IF NOT EXISTS idx_chat_messages_parent ON public.chat_messages(parent_message_id);
