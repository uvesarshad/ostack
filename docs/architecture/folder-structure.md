# Folder Structure

> **Scope:** Maps every folder to its purpose and naming conventions. **Rendering context:** N/A **Last updated:** 2026-05-15

## Overview

The project follows a standard Obsidian plugin structure with source code in `src/` and built-in skills mirrored in `skills/` (the runtime source of truth is `src/builtin-skills.ts` — `skills/` is a human-readable copy for the repo). The build output lives at the repo root so Obsidian can load it.

## Top-Level Folders

### src/
- Purpose: All TypeScript source.
- Naming: kebab-case filenames, PascalCase classes, camelCase functions/variables.
- AGENT OWNER: `src/main.ts`

Module map (alphabetical):

| File | Role |
|---|---|
| `agent-loop.ts` | Bounded streaming Anthropic tool-use loop for `agent: true` skills. |
| `bar-chat.ts` | Floating conversation surface (`BarChat`). Free-text chat, skill kickoff, agent runs, ASK protocol, compaction. |
| `builtin-skills.ts` | Embedded source-of-truth for the built-in skills (research, plan, plan-interactive, campaign, outline, review, summarize, vault-agent). |
| `chat-runner.ts` | Legacy free-chat path used by sidebar — assembles context, resolves mentions, streams via the provider. |
| `chat-store.ts` | Markdown-sidecar chat persistence (`_agent/chats/*.md`); migration from legacy `data.json`. |
| `context-builder.ts` | BFS vault traversal, metadata scoring, XML formatting with framing-tag defang. |
| `context-scout.ts` | Optional semantic re-ranking via a cheap small model. |
| `floating-input.ts` | Centered progress overlay (`.gstack-fi-*`); used by `skill-runner` as the legacy progress reporter. |
| `import-skill-modal.ts` | GitHub-import UI with skill-name sanitization. |
| `main.ts` | Plugin entry point. Lifecycle, command registration, view registration. |
| `manage-skills-modal.ts` | List/open/delete custom skills under `_agent/`. |
| `mention-resolver.ts` | Shared `[[Wiki Link]]` extractor → `<mentioned-note>` blocks. |
| `output-router.ts` | Routes provider tokens to either inline editor insertion or a new note. |
| `settings.ts` | Settings tab UI + persisted `GStackSettings` shape + provider validation. |
| `sidebar-view.ts` | Right-sidebar chat panel (`OgstackSidebarView`). |
| `skill-loader.ts` | Loads built-in + custom skills, watches `_agent/` for hot reload, parses SKILL.md. |
| `skill-runner.ts` | Legacy `runSkill` orchestrator — builds context, calls provider, routes output. Used for `auto_insert` skills run from the command palette. |
| `welcome-modal.ts` | First-run modal. |
| `yaml-mini.ts` | Minimal YAML frontmatter parser (quoted scalars, embedded colons, comments). |

### src/providers/
- LLM provider implementations.
- `claude.ts` — Claude API streaming + `streamWithTools` (tool-use loop primitive).
- `openai.ts`, `gemini.ts`, `grok.ts` — REST + SSE.
- `ollama.ts` — local NDJSON streaming.
- `cli.ts` — Spawns `claude-cli`/`codex-cli`/`gemini-cli` subprocesses with `shell: false`, validates path + model.
- `retry.ts` — Shared `fetchWithRetry` with `Retry-After` honoring (429/503 only, 10s cap).
- `provider-interface.ts` — Common `LLMProvider` interface + `getProvider` / `getScoutProvider` factories.
- AGENT SEE: docs/api/llm-providers.md

### src/tools/
- `vault-tools.ts` — Six vault tools (`read_note`, `write_note`, `append_note`, `list_notes`, `search_vault`, `get_active_note`) exposed to agent skills. Output caps + write gate live here.

### src/__tests__/
- Vitest tests. Naming: `[module].test.ts`. Subfolder `providers/` mirrors `src/providers/`. 161 tests at last count.

### src/__mocks__/
- `obsidian.ts` — Mock of Obsidian's plugin API surface for headless testing.

### skills/
- Human-readable copy of built-in `SKILL.md` files. **Not** loaded at runtime — `src/builtin-skills.ts` is the runtime source. Keep in sync when editing.

### docs/
- Project documentation for humans and AI agents. Organized by category (architecture, modules, api, state, ui, infra, auth).

### temp/
- Drafts, audit reports, task lists. Gitignored.

## Vault-side folders (created at runtime)

These are created inside the user's vault, not the plugin's repo:

### _agent/
- Custom skill home. Flat (`_agent/myskill.md`) or folder-based (`_agent/myskill/SKILL.md`).

### _agent/chats/
- One markdown file per chat session, `<note-slug>__<sessionId>.md`. Visible/searchable in Obsidian.

## Root Files

| File | Role |
|---|---|
| `main.js` | Bundled output. Loaded by Obsidian. |
| `manifest.json` | Plugin metadata: id, name, version, `requestUrls` allow-list. |
| `esbuild.config.mjs` | Build config. Reads `.env` for `VAULT_PATH` and syncs build output directly into the configured vault. |
| `styles.css` | Bundled stylesheet, section-indexed at the top. |
| `package.json` | npm metadata + scripts. |
| `tsconfig.json` | TypeScript config. |
| `vitest.config.ts` | Vitest config. |
| `.env.example` | Template for `VAULT_PATH` dev sync. |
| `SECURITY.md` | Threat model and reporting. |
| `README.md` | User-facing docs. |

## Related Docs

- docs/overview.md — High-level project map.
- docs/infra/deployment.md — Build + distribution.
