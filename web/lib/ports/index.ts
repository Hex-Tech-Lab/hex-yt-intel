/**
 * Transcript extraction port - Fetches raw video transcripts from third-party services.
 */
export * from './DecodoPort';

/**
 * Authentication port - Verifies user sessions and resolves subscription tier.
 */
export * from './AuthPort';

/**
 * Quota tracking port - Monitors API usage and enforces subscription limits.
 */
export * from './QuotaPort';

/**
 * Traffic rate limiting port - Protects endpoints from abuse.
 */
export * from './TrafficGuardPort';

/**
 * Billing quota enforcement port - Manages subscription-based feature access.
 */
export * from './BillingQuotaPort';

/**
 * Video metadata ingestion port - Fetches YouTube metadata and transcripts.
 */
export * from './IngestionPort';

/**
 * Metadata ingestion coordination port - Orchestrates metadata fetching workflow.
 */
export * from './MetadataIngestionPort';

/**
 * Model resolution port - Determines LLM model cascades per user tier.
 */
export * from './ModelResolutionPort';

/**
 * Cryptographic token port - Signs and validates HMAC streaming tokens.
 */
export * from './CryptographicTokenPort';

/**
 * Analysis persistence port - Stores analysis results and metadata.
 */
export * from './AnalysisPersistencePort';

/**
 * Knowledge graph persistence port - Stores graph entities and relationships.
 */
export * from './GraphPersistencePort';

/**
 * Billing persistence port - Manages subscription and billing data.
 */
export * from './BillingPersistencePort';

/**
 * Chat persistence port - Stores chat conversations and messages.
 */
export * from './ChatPersistencePort';

/**
 * Video player port - Manages YouTube player integration and playback.
 */
export * from './VideoPlayerPort';

/**
 * Settings persistence port - Stores user preferences and configurations.
 */
export * from './SettingsPersistencePort';
