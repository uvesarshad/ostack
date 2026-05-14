# Storage and Persistence

> **Scope:** Describes how the plugin persists data and interacts with the vault. **Rendering context:** Isomorphic **Last updated:** 2026-05-14

## Overview

ogstack does not use an external database. It relies entirely on Obsidian's internal storage mechanisms: the data.json file for settings and the vault filesystem for skills and notes.

## Persistence Layers

### Plugin Settings (data.json)
- Purpose: Stores API keys, provider selections, and feature toggles.
- Location: .obsidian/plugins/ogstack/data.json.
- Format: Plaintext JSON.
- AGENT NOTE: API keys are stored in plaintext. Users are warned not to sync this file to untrusted locations.

### Skill Definitions (SKILL.md)
- Purpose: Stores the system prompts and configurations for AI tasks.
- Location: .gstack/skills/[skill-name]/SKILL.md.
- Format: Markdown with YAML frontmatter.

### Chat Store (src/chat-store.ts)
- Purpose: Manages the temporary history of skill runs during a single session.
- Persistence: Currently in-memory, but can be synced to a dedicated history file in the vault.

## Vault Metadata Access

The plugin uses Obsidian's MetadataCache to read link relationships and file statistics (like mtime) without opening the files themselves. This is critical for the performance of the BFS traversal in the ContextBuilder.

## Related Docs

- docs/modules/context-engine.md — How metadata is used to score notes.
- docs/infra/environment.md — For the specific settings fields available.
