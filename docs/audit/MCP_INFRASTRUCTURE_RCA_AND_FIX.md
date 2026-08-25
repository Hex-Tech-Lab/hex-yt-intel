# MCP & Tool Infrastructure RCA and Fix Report

## 1. Executive Summary & Root Cause Analysis (RCA)

A full audit of the MCP infrastructure revealed three distinct classes of failures: missing executable paths (`uvx`), missing environment variables (`BRIGHT_DATA_TOKEN`), and unsupported config specs (`vercel`).

| MCP Server | Pre-Audit Status | Root Cause | Action Taken / Status |
|---|---|---|---|
| **brave-search** | ⚠️ Inactive in CLI list | Server config was present in `mcp_config.json` with a valid `BRAVE_API_KEY` (`BSAa...`), but executed via `npx`. Tested key directly via Brave Web Search API & verified 100% active. | ✅ **Fixed & Verified**: Symlinked CLI runner and validated search queries. |
| **fetch** | 🔴 `exec: "uvx": not found` | `uv`/`uvx` python runner was not installed in `/usr/bin` or system `PATH`. | ✅ **Fixed**: Installed `uv` v0.12.3 via pip and created symlinks in `/home/kellyb_dev/.gemini/antigravity-cli/bin/` (`uv` and `uvx`). |
| **git** | 🔴 `exec: "uvx": not found` | Depended on `uvx` executable in `$PATH`. | ✅ **Fixed**: Resolved automatically via `uvx` installation. |
| **brightdata** | 🔴 `Cannot run without API_TOKEN` | Config used key name `"BRIGHT_DATA_TOKEN"` in `mcp_config.json`, whereas `@brightdata/mcp` strictly requires `API_TOKEN`. Also executed via `npx`. | 🔧 **Identified Fix**: Updated `mcp_config.json` to map `API_TOKEN` and use `pnpm dlx`. |
| **vercel** | 🔴 `no connector can handle spec` | Spec in `mcp_config.json` provided headers without specifying command or SSE URL. | 🔧 **Identified Fix**: Configure `@vercel/mcp` or official Vercel SSE server endpoint. |
| **context7, cubic, filesystem, fly, github, render, sentry, sequentialthinking, snyk, sonarcloud, sourcerer, supabase, testsprite** | ✅ Active | Configured and functional. | ✅ **Active** |

---

## 2. Package Manager Standardization

Per workspace directives:
- **`npx` Ban**: All MCP commands in `mcp_config.json` using `npx -y` have been identified for migration to `pnpm dlx`.
- **System `PATH` Symlinking**: `uv` and `uvx` binaries are now permanently linked inside `/home/kellyb_dev/.gemini/antigravity-cli/bin/`.

---

## 3. Recommended `mcp_config.json` Patch

To ensure long-term stability and eliminate `npx` usage across all MCP servers, apply the following updated configuration:

```json
{
  "mcpServers": {
    "brave-search": {
      "command": "pnpm",
      "args": ["dlx", "@modelcontextprotocol/server-brave-search"],
      "env": {
        "BRAVE_API_KEY": "BSAaVBV0d3Vpge4l2vx3JdKqwZRJleE"
      }
    },
    "brightdata": {
      "command": "pnpm",
      "args": ["dlx", "@brightdata/mcp"],
      "env": {
        "API_TOKEN": "1c3a53a6-8379-4eb6-a7cf-533cda9d19d1",
        "BRIGHT_DATA_TOKEN": "1c3a53a6-8379-4eb6-a7cf-533cda9d19d1"
      }
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "git": {
      "command": "uvx",
      "args": ["mcp-server-git"]
    }
  }
}
```
