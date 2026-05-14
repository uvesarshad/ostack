# Environment and Configuration

> **Scope:** Lists required settings and configuration options. **Rendering context:** N/A **Last updated:** 2026-05-14

## Overview

Configuration in ogstack is handled through the Obsidian settings UI. While there are no system-level environment variables (like .env files in a server app), the plugin's data.json serves a similar purpose.

## Configuration Fields

### Core Settings
- provider: The active LLM backend ('claude' | 'openai' | 'gemini' | 'ollama').
- apiKey: The secret key for the active provider (stored in data.json).
- model: The specific model ID (e.g., 'claude-3-5-sonnet-20240620').

### Context Engine Settings
- scoutEnabled: Boolean to toggle the semantic re-ranking pass.
- scoutModel: The model used for scouting (default: gemini-2.0-flash-lite).
- contextDecayDays: Number of days used in the recency scoring formula (default: 14).
- maxTokens: The maximum token budget for the assembled context.

### UI Settings
- outputMode: Global default for skill output ('inline' | 'new-note').

## Development Environment

For development, a .env file may be used by the build script (esbuild.config.mjs) to inject specific variables, but these are not used by the plugin at runtime in the user's vault.

## Related Docs

- docs/api/storage.md — How these settings are persisted.
- docs/modules/context-engine.md — How the engine settings affect traversal.
