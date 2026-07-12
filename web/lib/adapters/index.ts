/**
 * Decodo transcript extraction adapter.
 * Provides methods for fetching and parsing video transcripts from Decodo.
 */
export { DecodoAdapter } from './DecodoAdapter';

/**
 * Supabase authentication adapter.
 * Implements AuthPort to authenticate users and retrieve their tier/permissions.
 */
export { SupabaseAuthAdapter } from './SupabaseAuthAdapter';

/**
 * Redis-backed traffic/rate limiting adapter.
 * Tracks API usage and enforces rate limits using Upstash Redis.
 */
export { RedisTrafficAdapter } from './RedisTrafficAdapter';

/**
 * PostgreSQL billing data adapter.
 * Manages subscription, invoice, and usage billing information in Postgres.
 */
export { PostgresBillingAdapter } from './PostgresBillingAdapter';

/**
 * Worker ingestion adapter.
 * Handles video analysis request ingestion from the Cloudflare Worker.
 */
export { WorkerIngestionAdapter } from './WorkerIngestionAdapter';

/**
 * Settings model configuration adapter.
 * Manages LLM model routing, fallback cascades, and configuration parameters.
 */
export { SettingsModelAdapter } from './SettingsModelAdapter';

/**
 * Upstash Vector Store adapter.
 * Provides vector embedding storage and similarity search for knowledge graph entities.
 */
export { UpstashVectorAdapter } from './UpstashVectorAdapter';

/**
 * Stream token management adapter.
 * Handles token counting and rate limiting for streaming responses.
 */
export { StreamTokenAdapter } from './StreamTokenAdapter';

/**
 * Supabase persistence adapter.
 * Implements PersistencePort for storing analyses, dimensions, and chat data in Supabase.
 */
export { SupabasePersistenceAdapter } from './SupabasePersistenceAdapter';

/**
 * Supabase analysis query adapter.
 * Provides methods for retrieving and querying analysis data.
 */
export { SupabaseAnalysisAdapter } from './SupabaseAnalysisAdapter';

/**
 * Supabase chat message adapter.
 * Manages chat conversation storage and retrieval.
 */
export { SupabaseChatAdapter } from './SupabaseChatAdapter';

/**
 * Supabase knowledge graph adapter.
 * Handles storage and retrieval of graph entities and relationships.
 */
export { SupabaseGraphAdapter } from './SupabaseGraphAdapter';

/**
 * Supabase billing adapter.
 * Manages billing-related database operations and subscription tracking.
 */
export { SupabaseBillingAdapter } from './SupabaseBillingAdapter';

/**
 * YouTube IFrame Player adapter.
 * Integrates YouTube player controls and playback seeking functionality.
 */
export { YouTubePlayerAdapter } from './YouTubePlayerAdapter';

/**
 * Synthesis stream response adapter.
 * Parses, accumulates, and normalizes streaming JSON responses from LLM models.
 */
export { SynthesisStreamAdapter } from './synthesis-stream-adapter';