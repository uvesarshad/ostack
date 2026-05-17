# ogstack Overview

> Scope: Central index, tech stack, and architectural baseline for the ogstack Obsidian plugin.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack is a vault-aware skill system for Obsidian that allows users to run gstack-style AI skills directly within their notes. The plugin walks the note graph, scores and semantic-ranks linked notes, packages them into an XML context window, and streams the output directly into the active editor or a new note side-car. It runs entirely inside the client Obsidian application without external SDKs or server processes.

## Project Tier and Environment Rationale
ogstack is classified as a Tier 3 (Full-Stack / API-Driven) project. Although it has no typical web server backend, it drives complex local workflows, manages child process CLI executors, and interacts with multiple external API providers via client-side streaming and long-lived Server-Sent Events.

Environment context:
- Runtime: Obsidian Plugin API under Electron (Node.js and browser environments)
- Language: TypeScript compiled via esbuild
- Framework: Obsidian API SDK
- Main rendering: Client-side rendering (CSR) via Obsidian DOM nodes
- Main API endpoints: Direct connections to Anthropic, OpenAI, Google AI Studio, x.ai, Ollama localhost, and GitHub raw APIs

## Key Architectural Decisions
- No External LLM SDKs: All network requests use Obsidian's native requestUrl or standard browser fetch APIs to keep the compiled bundle under 500 KB and prevent dependency bloat.
- Two-Stage Context scoring: The plugin first runs a fast, memory-only BFS traversal and decay scoring, followed by an optional semantic re-ranking turn using a fast, inexpensive LLM (Context Scout).
- Persistent Markdown Sidecars: Instead of a heavy JSON database, ChatStore persists individual chat sessions as markdown files in the _agent/chats/ directory inside the user's vault, enabling instant local search, sync, and light writes.
- File-Write Safety Gate: Any skill attempting to write or append note files is stopped by a safety setting unless explicitly enabled in settings, protecting the vault from prompt-injection compromises.

## Directory Map
- docs/overview.md: Central architecture overview, glossary, and recent changes index.
- docs/architecture/folder-structure.md: Top-level folder layout, naming conventions, and layout rules.
- docs/architecture/rendering-strategy.md: Client-side rendering mechanics, node integrations, and child processes.
- docs/architecture/data-flow.md: Step-by-step pipeline from prompt entry to output routing.
- docs/ui/component-library.md: Shared UI modals, textareas, and interactive states.
- docs/ui/layout-system.md: Obsidian leaves, workspaces, status bar integration, and DOM events.
- docs/ui/theming.md: CSS stylesheet variables, Obsidian global themes, and animation controls.
- docs/api/llm-providers.md: SSE response chunk parsing, CLI executors, and provider interfaces.
- docs/api/storage.md: Markdown-sidecar serialization rules, YAML frontmatter, and parallel scan pipelines.
- docs/api/external-services.md: Third-party LLM service integrations, keys, and GitHub downloader contracts.
- docs/state/app-state.md: Active-leaf trackers, store changes, and text buffer caching.
- docs/infra/environment.md: Vault path settings, keys storage, and security.
- docs/infra/testing.md: Vitest configurations, mock objects, and verification scripts.
- docs/modules/context-engine.md: BFS note graph traversal, scoring formulas, and semantic scout re-ranking.
- docs/modules/ui-system.md: Input bar DOM managers, relative timers, and suggest popups.
- docs/modules/skill-system.md: Custom skill watchers, loader registries, and tool loop controllers.

## Cross-Cutting Concerns
- Authentication: API keys are inputted by the user in the settings tab and stored in plaintext inside the vault's data.json file.
- Error Handling: Stream abort errors, timeouts, and network failures are captured, formatted via provider-specific wrappers, and rendered as user-facing error notices or inline error elements.
- Data Fetching: Parallel reads are performed using app.vault.cachedRead during BFS. Remote completions use fetch or requestUrl with a custom exponential backoff retry wrapper for rate limits.
- Styling: Custom styles are contained in styles.css, leveraging Obsidian CSS variables so the interface naturally shifts between community themes and dark/light modes.

## Glossary
- BFS Traversal: Breadth-First Search traversal that starts at the active note and discovers forward-linked files up to a configured max depth.
- Context Scout: A fast, inexpensive helper LLM that reads note previews and returns relevance scores (0.0 to 1.0) and descriptive annotations.
- Active Note: The note currently open in the active Obsidian editor, which acts as the BFS root.
- Skill: A markdown file with YAML frontmatter containing metadata and a system prompt representing a specialised agent task.
- Sidecar: A chat session markdown file created in the vault to store conversation history and tool outputs.

## Recent Changes
- [2026-05-15] Shipped security hardening (Sprint 1) including skill path sanitization, shell: false CLI spawning, and agent write setting gates. Updated docs/overview.md and docs/api/storage.md.
- [2026-05-15] Shipped agent correctness patches (Sprint 2 & 3) matching tool use IDs, adding 120s stream timeouts, persisting messages across multiple turns, and debouncing suggest scans. Updated docs/modules/skill-system.md.

## Update Triggers
- When a new documentation file is added or removed from the docs directory.
- When there is a major architectural shift or new cross-cutting concern.
- When new changes are shipped that must be documented in the Recent Changes log.

AGENT UPDATE: update docs/overview.md when directories restructure or major features shift.

## Related Docs
- docs/architecture/folder-structure.md — Structural layout of files.
- docs/architecture/rendering-strategy.md — Client execution model.
- docs/architecture/data-flow.md — Data paths.
