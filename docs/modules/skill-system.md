# Skill and Agent Tool System

> Scope: Skill compilation, directory hot-watchers, Claude tool-use agent loops, round limits, and vault write security gates.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
The Skill and Agent Tool System handles loading, parsing, and executing AI skills. It manages built-in commands, watches the vault for custom skill updates, drives multi-turn agentic loops on Claude's tool-use API, and gates agent tools to protect note files.

## Key Modules
- createSkillLoader: Factory in skill-loader.ts. Registers skill commands and watches vault folders.
- runClaudeAgent: Generator loop in agent-loop.ts. Drives multi-round Claude tool turns.
- executeVaultTool: Router in tools/vault-tools.ts that executes local operations (e.g. note reads and vault searches).

## Custom Skill Loader and Watcher
- Formats: Custom skills are markdown files containing a YAML metadata header and system prompt. They can be written as flat files (e.g. _agent/skill_name.md) or nested folders (e.g. _agent/skill_name/SKILL.md).
- Command Registration: The loader parses files, registers them as Obsidian command entries (with gs: prefixes), and generates removal callbacks.
- Hot-Reloading Folder Watcher: The loader listens to vault event triggers (create, modify, delete, rename) inside _agent/. When changes are detected, it unregisters commands and loads custom skills again, debounced using a 300ms timer to handle concurrent edits smoothly.
- Collisions: If a custom skill uses a protected built-in skill name (such as research or review), it is ignored, and a warning Notice is displayed showing the file path.

## The Claude Agent Loop
- Streaming Turns: Implemented in agent-loop.ts. Coordinates assistant turns over Claude's streamWithTools SSE.
- Loop Cycles:
  - Phase 1: streams text chunks (yielded as text_delta) and collects tool call definitions.
  - Phase 2: If the stream stops with tool_use, the loop calls executeVaultTool, appending result segments.
  - Phase 3: Sends results back to Claude, starting another streaming turn.
- Conversational state: Once an agent skill runs in a session, follow-up messages are marked with agentSkillName, continuing the agentic loop across multiple turns.
- Round Capping: Loops cap at maxRounds (default: 10, frontmatter configurable). An absolute hard limit of 40 rounds prevents runaway API costs from infinite loops.

## Vault Tools and Write Gating
Tools are configured in tools/vault-tools.ts:
- read_note: Reads file contents, capped at 12,000 characters to protect context limits.
- search_vault: Scans notes for substring matches, capped at 2,000 scanned notes and 4,000 output characters.
- list_notes: Lists markdown files in folders, capped at 200 notes.
- get_active_note: Returns the path and contents of the active note.
- File Write Gating: The write_note and append_note tools are blocked by default. If allowAgentWrites is false, they return a clear security error. The agent surfaces this limitation to the user, offering the proposed note changes as a markdown copy box instead.

## Update Triggers
- When new tools are added or parameters change in tools/vault-tools.ts.
- When loader directories or hot-watcher event listeners are modified in skill-loader.ts.
- When agent generator steps or round ceilings are refactored in agent-loop.ts.

AGENT UPDATE: update docs/modules/skill-system.md when loader settings, agent loops, or vault tools are modified.

## Related Docs
- docs/overview.md — Glossary and tech stack.
- docs/api/llm-providers.md — SSE provider interfaces.
- docs/modules/context-engine.md — Context gathering BFS.
