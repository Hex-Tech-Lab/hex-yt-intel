/**
 * TranscriptSlice (worker) — thin re-export of the shared, isomorphic
 * transcript-slice implementation in web/lib so the (startWord, endWord,
 * sha256) triple computation has a single source of truth across the Vercel
 * signer and the worker-side re-cut/re-hash (R3b 2.3.5b/2.3.5d).
 *
 * The implementation is bundled by esbuild and uses only Web Crypto
 * (`crypto.subtle`) — available in Cloudflare Workers and Node 18+.
 */

export {
  tokenizeTranscript,
  sliceText,
  sha256HexIsomorphic,
  EMPTY_SLICE_SHA256,
  sliceDigest,
} from '../../../web/lib/jev/transcript-slice';
