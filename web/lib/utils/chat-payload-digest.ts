import { canonicalJson } from './canonical-json';
import { sha256HexIsomorphic } from '../jev/transcript-slice';

/** The chat-stream fields the browser relays to the worker that decide what the LLM sees and which models run. */
export interface ChatSignedPayload {
  tier?: string;
  grounding?: string;
  history?: Array<{ role: string; content: string }>;
  cascade?: Array<{ model: string; name: string; cost?: number; providerOrder?: string[] }>;
}

/**
 * sha256 of the canonical JSON of the relayed chat payload. Shared by the
 * Vercel signer and the worker verifier, so a signed-in user can't edit
 * grounding, history, tier or cascade between the two (the browser carries
 * the payload; before this only the model list was signed).
 */
export function chatPayloadDigest(payload: ChatSignedPayload): Promise<string> {
  const { tier, grounding, history, cascade } = payload;
  return sha256HexIsomorphic(canonicalJson({ tier, grounding, history, cascade }));
}

/** The signed chat message; `digest` is chatPayloadDigest of the relayed payload. */
export function chatTokenMessage(conversationId: string, userId: string, exp: number, models: readonly string[], digest: string): string {
  return `chat:${conversationId}:${userId}:${exp}:${[...models].sort().join(',')}:${digest}`;
}
