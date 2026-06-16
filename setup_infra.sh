#!/usr/bin/env bash
set -euo pipefail

echo "Executing safe, idempotent tools provisioning..."

# Global installation check
if ! command -v opencode &> /dev/null; then
    pnpm add -g opencode-ai@latest
fi

# Config directory preparation
CONFIG_DIR="$HOME/.config/opencode"
mkdir -p "$CONFIG_DIR"

# Write endpoint routes non-destructively
if [ ! -f "$CONFIG_DIR/opencode.json" ]; then
    cat << 'INNER_EOF' > "$CONFIG_DIR/opencode.json"
{
  "provider": {
    "bifrost": {
      "npm": "@ai-sdk/openai",
      "name": "Bifrost-Gateway",
      "options": {
        "baseURL": "http://localhost:8080/v1",
        "apiKey": "bifrost-local"
      },
      "models": {
        "qwen-coder": { "name": "Qwen/Qwen2.5-Coder-32B-Instruct" },
        "nemotron-review": { "name": "NVIDIA/Nemotron-4-340B-Instruct" },
        "deepseek-arch": { "name": "DeepSeek-R1" }
      }
    }
  }
}
INNER_EOF
fi

# Link global skills folder mapping safely
WORKSPACE_SKILLS="./packages/shared-types/skills"
if [ -d "$WORKSPACE_SKILLS" ]; then
    mkdir -p "$CONFIG_DIR/skills"
    rm -rf "$WORKSPACE_SKILLS"
    ln -sfn "$CONFIG_DIR/skills" "$WORKSPACE_SKILLS"
fi

# Spawn Bifrost local server on Port 8080
echo "Launching local Bifrost background service daemon..."
pnpm dlx @maximhq/bifrost --port 8080 > /dev/null 2>&1 &

echo "Setup completed successfully."
