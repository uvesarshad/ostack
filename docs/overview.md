# Project Overview: ogstack

> **Scope:** High-level entry point for the ogstack project. **Rendering context:** Client (Obsidian Plugin) **Last updated:** 2026-05-15

## Overview

ogstack is a vault-aware skill system for Obsidian that allows users to run AI-powered "skills" directly on their local notes. It leverages the Obsidian metadata graph to build context for LLMs, supporting multiple providers (Claude, OpenAI, Gemini, Grok, Ollama) plus subscription CLIs (Claude Code, Codex, Gemini CLI). The project is built with TypeScript and ships in two execution modes:

1. **Oneshot skills** — system prompt + assembled vault context → streamed completion → inserted at cursor or routed to a new note.
2. **Agent skills** — Claude tool-use loop with a curated set of vault tools (`read_note`, `list_notes`, `search_vault`, `get_active_note`, `append_note`, `write_note`). Writes are gated by a setting (default off).

## Tech Stack

- Core: TypeScript
- Platform: Obsidian Plugin API (desktop-only — uses `child_process` for CLI providers)
- Build: esbuild
- Testing: Vitest (123 unit tests)
- LLM Integration: Native fetch API with Server-Sent Events (SSE) for streaming; Anthropic streaming tool-use for agent skills
- State Management: Per-note chat sidecar files under `_agent/chats/`; settings in `.obsidian/plugins/ogstack/data.json`

## Directory Map

### ARCHITECTURE
- docs/architecture/execution-model.md — Describes the plugin lifecycle and command registration within Obsidian.
- docs/architecture/data-flow.md — Maps the journey from vault traversal to LLM response streaming.
- docs/architecture/folder-structure.md — Explains the purpose of each top-level directory and naming conventions.

### MODULES / FEATURES
- docs/modules/skill-engine.md — Covers the skill loader, built-in skills, and custom SKILL.md parsing (`_agent/` folder).
- docs/modules/context-engine.md — Details BFS traversal, metadata scoring, and the Context Scout semantic re-ranker.
- docs/modules/ui-system.md — Describes the sidebar, floating bar, welcome modal, and GitHub skill-import modal.

### API & DATA
- docs/api/llm-providers.md — Lists supported LLM providers and their specific implementation details, plus the CLI provider (`claude-cli` / `codex-cli` / `gemini-cli`) and its `shell: false` hardening.
- docs/api/storage.md — Explains how settings, chat sessions, and metadata are persisted.

### INFRASTRUCTURE & CONFIG
- docs/infra/environment.md — Lists required settings and API key handling.
- docs/infra/deployment.md — Describes the build process and plugin distribution format.
- docs/infra/testing.md — Outlines the Vitest-based testing strategy and mock environment.

## Key Architectural Decisions

- **Vault-Aware BFS Traversal:** The system uses Obsidian's `resolvedLinks` to find context instead of a vector database, prioritizing link depth and recency. BFS caps at 200 nodes; ceiling depth is 5.
- **Context Scout Optimization:** A secondary, cheaper model (default `gemini-2.0-flash-lite`) is used to prune the context before the primary model runs. Scout can run on a different provider than the main one — see settings `scoutProvider`.
- **Stream-to-Editor:** Output is streamed directly into the Obsidian editor via per-note mutexes to prevent concurrent write collisions.
- **No-Dependency Streaming:** Uses native `fetch` and `TextDecoder` to handle SSE, avoiding heavy external SDKs.
- **Markdown sidecar chat store:** Each chat session is a markdown file under `_agent/chats/<note-slug>__<id>.md` — visible in the vault, searchable, and sync-friendly (per-file diffs instead of one giant `data.json`).
- **Agent loop on Anthropic tool-use:** `src/agent-loop.ts` runs a bounded (max 10 rounds) streaming tool-use loop. Tool calls and results are matched by `tool_use_id` (not name/order) so parallel calls compose safely.
- **CLI provider with `shell: false`:** CLI providers (Claude Code, Codex, Gemini CLI) are spawned without a shell. PATH × PATHEXT resolution is performed in-process so `.cmd`/`.bat` shims still work on Windows without exposing the args to a shell interpreter.

## Cross-Cutting Concerns

- **Auth Strategy:** API keys are stored in plaintext at `.obsidian/plugins/ogstack/data.json`. Obsidian Sync excludes plugin data by default; third-party sync (Git, Dropbox, iCloud) carries the file unless explicitly excluded.
- **Error Handling:** Uses Obsidian `Notice` for user-facing errors, in-chat error bubbles for streaming failures, and `console.warn` for non-fatal background issues.
- **Styling:** Leverages Obsidian's internal CSS variables for native look-and-feel.
- **Security model:**
  - Imported skill names (from GitHub) are validated against `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$` before being used as path segments — prevents path traversal via malicious frontmatter.
  - CLI path and model name from settings are validated against shell metacharacters before being passed to `child_process.spawn`.
  - Agent file writes (`write_note`, `append_note`) are denied by default and return an error string the agent reports back to the user. Opt in via Settings → Agent safety.

## Glossary

- **Skill:** A markdown-based prompt template (`SKILL.md`) that defines a specific AI task. Frontmatter declares `name`, `description`, optional `agent`, `allowed_tools`, `output`, `max_depth`, `max_tokens`, `mode`.
- **Agent skill:** A skill with `agent: true` that runs through the Anthropic tool-use loop with vault tools instead of a single streamed completion.
- **Context Scout:** A small/cheap model used to semantically score notes before they are included in the final LLM prompt.
- **Vault Context:** The assembled XML-tagged block containing the content of the active note + scored linked notes, substituted into the skill's `{{VAULT_CONTEXT}}` placeholder.
- **Per-Note Mutex:** A locking mechanism that prevents multiple skills from writing to the same note simultaneously.
- **Mention resolver:** Extracts `[[Wiki Link]]` references from a user message and inlines their content as `<mentioned-note>` blocks for that turn. Shared between the bar and sidebar chat surfaces (`src/mention-resolver.ts`).

## Related Docs

- docs/how-to-update-docs.md — Rules for maintaining this documentation.
- temp/AUDIT_REPORT.md — Most recent full audit (2026-05-15).
- temp/AUDIT_TASKS.md — Sprint-organized follow-up tasks from the audit.
