# Environment Configuration

> Scope: Environment variables, setting configurations, and secure credential storage.
> Rendering context: N/A
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack has two distinct environment configurations: a build-time system configuration using environment variables for file mirroring, and a runtime user configuration managed through Obsidian settings and persistent storage.

## Build-time Environment Variables
The build system relies on a local .env configuration file placed in the repository root. It contains:
- VAULT_PATH: The absolute system path to a target Obsidian vault directory (the folder containing the .obsidian directory). The build script, defined in esbuild.config.mjs, reads this path to copy compiled bundle files (main.js, manifest.json, and styles.css) directly to the target vault's plugin directory on every compilation turn.

AGENT NOTE: If VAULT_PATH is not configured or is invalid, esbuild will output files to the local dist directory instead of mirroring them into Obsidian.

## Runtime Settings Storage
All user-facing settings are stored in Obsidian's standard data.json configuration file. This file resides inside the plugin directory at the path: .obsidian/plugins/ogstack/data.json.
- Credentials: API keys for Claude, OpenAI, Gemini, Grok, and Ollama hosts are saved in plaintext in this file.
- Sync Behaviors: Obsidian Sync excludes plugin configurations from synchronization by default. However, third-party sync protocols (such as Git, iCloud, or Dropbox) will mirror this file across devices. Users sharing their vaults publicly must explicitly exclude data.json to prevent credential leaks.

## Safety Setting Defaults
- Allow Agent File Writes: Stored as allowAgentWrites, this boolean controls whether agent skills can perform write_note and append_note tool operations. By default, it is false (disabled) to block malicious prompt injections from modifying vault notes.

## Update Triggers
- When a new environment variable is added to the esbuild pipeline.
- When new API provider options or keys are added to settings.ts.
- When the storage location or sync exclusion policy of keys changes.

AGENT UPDATE: update docs/infra/environment.md when settings keys or build environment variables change.

## Related Docs
- docs/overview.md — General project tech stack.
- docs/infra/testing.md — Local test execution environment.
