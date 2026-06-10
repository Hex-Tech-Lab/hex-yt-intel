# SettingsModelAdapter Architecture

The `SettingsModelAdapter` handles the resolution of LLM models based on user tier and environment state.

## Commercial Trial Mode
- **Default Behavior**: The system defaults to `true` (commercial trial mode).
- **Configuration**: 
  - Can be overridden via dependency injection in the constructor: `config.commercialTrialMode`.
  - Can be configured via environment variable `COMMERCIAL_TRIAL_MODE` (string 'true'/'false').
