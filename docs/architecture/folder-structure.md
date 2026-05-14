# Folder Structure

> **Scope:** Maps every folder to its purpose and naming conventions. **Rendering context:** N/A **Last updated:** 2026-05-14

## Overview

The project follows a standard Obsidian plugin structure with source code in the src directory and built-in skills in the skills directory. The build output is located in the root for Obsidian compatibility.

## Top-Level Folders

### src/
- Purpose: Contains all TypeScript source code.
- Naming: kebab-case for filenames, PascalCase for classes, camelCase for functions and variables.
- AGENT OWNER: src/main.ts

### src/providers/
- Purpose: Implementation of different LLM provider interfaces (Claude, OpenAI, Gemini, Ollama).
- AGENT SEE: docs/api/llm-providers.md

### src/__tests__/
- Purpose: Unit tests and integration tests using Vitest.
- Naming: [module].test.ts

### src/__mocks__/
- Purpose: Mock implementations of external APIs like the Obsidian API for testing.

### skills/
- Purpose: Default SKILL.md files shipped with the plugin (Research, Campaign, etc.).
- Structure: Each skill has its own folder containing a SKILL.md file.

### docs/
- Purpose: Project documentation for humans and AI agents.
- Structure: Organized by category (Architecture, Modules, API, etc.).

### temp/
- Purpose: Temporary files, PRDs, and draft documents not intended for production.

## Root Files

### src/main.ts
- Role: The entry point for the Obsidian plugin. Handles lifecycle events (onload, onunload) and command registration.

### manifest.json
- Role: Metadata for the Obsidian plugin, including ID, name, version, and required permissions (e.g., requestUrls).

### esbuild.config.mjs
- Role: Build configuration for bundling the TypeScript source into a single main.js file.

### styles.css
- Role: Global styles for UI components like the floating input and sidebar.

## Related Docs

- docs/overview.md — For a high-level view of the project components.
