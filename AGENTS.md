# Agent Instructions — ogstack

## Start here
Read docs/overview.md before doing anything else.
It contains the full mental model: stack, architecture, data flow, module map, and glossary.

## Documentation index
docs/overview.md lists every doc file and what it covers.
Navigate from there. Do not rely on memory or assumptions.

## Before every task
1. Read docs/overview.md
2. Read the relevant module doc in docs/modules/ if one exists
3. Make the change
4. Run the update decision tree in the ## Update Rules section of docs/overview.md or follow AGENT UPDATE: tags in the affected doc files
5. Output a DOCS UPDATED summary before marking the task complete

## Hard rules
- Never invent file paths, component names, or type names. Always verify against the actual codebase.
- Never add 'use client' to a Server Component without checking docs/architecture/rendering-strategy.md first.
- Never add an environment variable without updating docs/infra/environment.md.
- Never modify the database schema without updating docs/api/database.md.
- If a docs/ file would exceed 200 lines after your update, split it and update docs/overview.md to list both parts.

## Docs update tags
Throughout the /docs files you will find:
  AGENT NOTE:  — constraint you must follow
  AGENT SEE:   — cross-reference to read
  AGENT AVOID: — anti-pattern to skip
  AGENT UPDATE: — doc files to update when this area changes

## Stack summary
TypeScript, esbuild, Vitest, and the Obsidian Plugin SDK compiled to client-side JS using native browser fetches and requestUrl to stream LLM provider endpoints.

## Key paths
- src/main.ts (Plugin entry point registering views, commands, and events)
- src/chat-store.ts (Markdown sidecar parser and session cache manager)
- src/bar-chat.ts (Floating conversation command bar and suggestion UI)
- src/sidebar-view.ts (Sidebar chat view layout and messaging dashboard)
- src/context-builder.ts (BFS vault notes graph compiler and XML formatter)
- src/agent-loop.ts (Claude tool-use assistant-loop and result appender)
- src/providers/ (LLM streaming providers: Claude, Gemini, OpenAI, Grok, Ollama)
- src/tools/vault-tools.ts (Agent tool executors with file-write permissions gate)
