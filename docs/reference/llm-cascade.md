# LLMCascade Architecture

LLMCascade is the LLM Transport Adapter for the YouTube Intelligence Platform.

## Description
Implements `LLMCascadePort`. Owns the OpenRouter multi-model fallback chain and the two transport adapters (streaming + non-streaming).

## Key Features
- **Config-only**: All request-scoped state stays in method locals, ensuring it is race-free when shared.
- **Multi-model fallback**: Automatically cycles through a prioritized list of models (Gemini 2.0 Flash, Claude 3.5 Haiku, Nemotron) to ensure reliable output even if specific providers fail or are rate-limited.
- **Dual Transport**: Supports both real-time Server-Sent Events (SSE) streaming and legacy non-streaming requests.
