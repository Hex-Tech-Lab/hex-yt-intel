/**
 * Decodo transcript extraction adapter.
 * Fetches and parses video transcripts from the Decodo API service.
 */
export { DecodoAdapter } from './DecodoAdapter';

/**
 * Supabase authentication adapter.
 * Authenticates users and retrieves subscription tier information.
 */
export { SupabaseAuthAdapter } from './SupabaseAuthAdapter';

/**
 * Redis-backed traffic rate limiting adapter.
 * Tracks API calls and enforces per-user rate limits using Upstash Redis.
 */
export { RedisTrafficAdapter } from './RedisTrafficAdapter';

/**
 * PostgreSQL billing data adapter.
 * Manages subscription invoices, payments, and usage billing through Postgres.
 */
export { PostgresBillingAdapter } from './PostgresBillingAdapter';

/**
 * Worker ingestion adapter.
 * Handles analysis job ingestion from the Cloudflare Worker streaming pipeline.
 */
export { WorkerIngestionAdapter } from './WorkerIngestionAdapter';

/**
 * LLM model settings adapter.
 * Manages model routing configurations, fallback cascades, and token limits.
 */
export { SettingsModelAdapter } from './SettingsModelAdapter';

/**
 * Upstash Vector Store adapter.
 * Provides vector embeddings storage and similarity search for knowledge graph.
 */
export { UpstashVectorAdapter } from './UpstashVectorAdapter';

/**
 * Stream token management adapter.
 * Handles token counting and rate limiting for streaming API responses.
 */
export { StreamTokenAdapter } from './StreamTokenAdapter';

/**
 * Supabase persistence adapter.
 * Implements core data persistence for analyses, dimensions, and metadata.
 */
export { SupabasePersistenceAdapter } from './SupabasePersistenceAdapter';

/**
 * Supabase analysis query adapter.
 * Queries and retrieves stored analysis results and history.
 */
export { SupabaseAnalysisAdapter } from './SupabaseAnalysisAdapter';

/**
 * Supabase chat message adapter.
 * Manages chat conversation storage, retrieval, and message history.
 */
export { SupabaseChatAdapter } from './SupabaseChatAdapter';

/**
 * Supabase knowledge graph adapter.
 * Stores and retrieves graph entities, relationships, and topology data.
 */
export { SupabaseGraphAdapter } from './SupabaseGraphAdapter';

/**
 * Supabase billing adapter.
 * Handles billing-related database operations and transaction records.
 */
export { SupabaseBillingAdapter } from './SupabaseBillingAdapter';

/**
 * YouTube IFrame Player adapter.
 * Integrates YouTube player controls, seeking, and playback management.
 */
export { YouTubePlayerAdapter } from './YouTubePlayerAdapter';

/**
 * Synthesis stream response adapter.
 * Parses, accumulates, and normalizes streaming JSON responses from LLM models.
 */
export { SynthesisStreamAdapter } from './synthesis-stream-adapter';
