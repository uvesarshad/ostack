# Folder Structure

> Scope: Directory mapping, conventions, and framework layout rules.
> Rendering context: N/A
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack organizes its codebase into functional directories separating UI components, API providers, agent tool executors, and unit tests. The file structure respects Obsidian community plugin packaging guidelines, compiling to a single file at the root.

## Top-Level Directories and Files
- src: Holds all TypeScript source files.
- src/providers: Holds the API provider integrations for Claude, OpenAI, Gemini, Grok, Ollama, and shell-less CLI executors.
- src/tools: Contains vault-specific tools (read_note, search_vault, etc.) used by agentic loops.
- src/__tests__: Houses all Vitest test suites, matching the directory layout of the source files.
- skills: Houses built-in skill files used to seed the initial command lists.
- temp: Temporary testing buffers, audit checklists, and script inputs.
- main.js: The compiled, bundled, and ready-to-run output file loaded by Obsidian.
- manifest.json: Obsidian metadata containing the plugin name, version, description, entry points, and network privileges.
- styles.css: The global stylesheet containing layout structures for floating chat inputs, sidebars, and suggest popups.

## Naming Conventions
- Component files: Named in kebab-case representing their structural domain (such as bar-chat.ts or floating-input.ts).
- Class names: Expressed in PascalCase (such as BarChat or ChatStore).
- Providers: Expressed in camelCase or PascalCase representing the model company (such as ClaudeProvider in claude.ts).
- Test files: Co-located by folder structure under src/__tests__ and named by appending .test.ts to their matching source module (such as chat-store.test.ts for chat-store.ts).

## Co-Located vs. Shared Files
- Custom styles live in a single global styles.css at the root since Obsidian requires community plugins to be distributed as a single CSS block.
- Modular code logic (such as YAML parsing in yaml-mini.ts or mention resolving in mention-resolver.ts) is separated into shared modules, called by both the floating bar-chat.ts and the sidebar-view.ts.

## Update Triggers
- When folders are added, removed, or renamed.
- When file naming conventions are updated.
- When new root-level configuration files are introduced.

AGENT UPDATE: update docs/architecture/folder-structure.md when folders are renamed or structural conventions shift.

## Related Docs
- docs/overview.md — Directory list.
- docs/architecture/rendering-strategy.md — Compilation targets.
