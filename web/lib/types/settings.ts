/**
 * Settings type definitions for admin and user configuration.
 * Settings are the single source of truth for all configuration values.
 * No hard-coded configuration values should exist in the codebase.
 */

export interface DimensionConfig {
  number: number;
  name: string;
  label?: string;
  icon?: string;
  span?: 1 | 2 | 3;
  extraFields?: ('persona' | 'knowledgeGraph' | 'classification' | 'monetizationVerdict')[];
}

export interface StreamBundle {
  dimensions: number[];
}

export interface AdminSettings {
  id: string; // Always 'default' for singleton
  totalDimensions: number; // Core dimensions (1-N), not counting Dimension 0
  minUsableDimensions: number; // Minimum dimensions for "usable" analysis
  streamBundles: StreamBundle[];
  dimensionConfigs: Record<number, DimensionConfig>;

  // Model routing & timeouts
  modelCascade: string[]; // Ordered list of models to try
  connectionHandshakeTimeoutMs: number; // Hard timeout for connection
  tokenStreamingWindowMs: number; // Max read time for streaming response

  // Retry & resilience
  maxRetries: number;
  retryBackoffMs: number;
  abortOnPartialFailure: boolean;

  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface UserSettings {
  id: string; // UUID of user
  userId: string; // Foreign key to users table

  // User preferences
  preferredModel?: string;
  analysisDetailLevel?: 'basic' | 'standard' | 'comprehensive';
  autoSaveAnalyses: boolean;
  notificationsEnabled: boolean;

  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
}

export interface SettingsContextValue {
  adminSettings: AdminSettings | null;
  userSettings: UserSettings | null;
  isLoading: boolean;
  error: Error | null;
}
