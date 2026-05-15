# Skill Engine

> **Scope:** Manages the loading, parsing, and execution of AI skills. **Rendering context:** Isomorphic **Last updated:** 2026-05-15

## Overview

The Skill Engine bridges raw `SKILL.md` files and the LLM execution pipeline. It serves three skill kinds:

1. **Oneshot** — single streamed completion. Output streams inline at cursor or to a new note.
2. **Interactive** — same as oneshot but the model can pause and ask the user clarifying questions via `<ASK>question</ASK>` tags rendered as inline answer inputs.
3. **Agent** — Anthropic tool-use loop with curated vault tools. See `src/agent-loop.ts`.

## Key Components

### SkillLoader (`src/skill-loader.ts`)
- Discovers and parses `SKILL.md` files from `_agent/` (and the built-in set embedded in `builtin-skills.ts`).
- Watches `_agent/` for `create | modify | delete | rename` events; reloads custom skills with a 300ms debounce.
- Registers / unregisters Obsidian commands dynamically (`gs: <Title>`).
- Conflict resolution: if a custom skill's `name` matches a built-in, the custom one is skipped and a Notice fires with the source path.
- AGENT NOTE: Use `parseSKILL(content, sourcePath)` to test parsing in isolation.

### SkillRunner (`src/skill-runner.ts`)
- Legacy `runSkill` orchestrator. Used by the command palette for skills with `auto_insert: true` and `mode: oneshot`.
- Builds context, scouts, calls provider, routes output, holds per-note inline mutex.
- For interactive chat and agent skills, `BarChat.runSkill` is the orchestrator instead.

### AgentLoop (`src/agent-loop.ts`)
- Yields a stream of `AgentEvent`s (`text_delta`, `tool_call`, `tool_result`, `error`) for the bar to render live.
- Reads `max_rounds` from the skill (default 10, ceiling 40).
- Tool execution dispatched through `src/tools/vault-tools.ts` with the `allowWrites` flag plumbed from settings.

### Built-in Skills (`src/builtin-skills.ts`)
- Runtime source of truth — these strings are embedded in the bundle (no filesystem reads).
- The shipped set: `research`, `campaign`, `plan`, `plan-interactive`, `outline`, `review`, `summarize`, `vault-agent`.
- `skills/<name>/SKILL.md` files in the repo are a human-readable mirror — keep in sync when editing.
- AGENT AVOID: Users cannot modify these via the vault; the loader rejects custom skills that collide with these names. To override behavior, create a custom skill with a different `name`.

## Vault Tools (`src/tools/vault-tools.ts`)

Six tools exposed to agent skills via Anthropic's `tools` parameter:

| Tool | Input | Output cap |
|---|---|---|
| `read_note` | `{path}` | 12,000 chars + `[truncated: …]` marker |
| `write_note` | `{path, content}` | (gated by `allowAgentWrites` setting; refuses with error when off) |
| `append_note` | `{path, content}` | (gated by `allowAgentWrites`) |
| `list_notes` | `{folder?}` | Caps at 200 paths |
| `search_vault` | `{query}` | Up to 20 matches, 4,000 chars total, scans at most 2,000 files |
| `get_active_note` | `{}` | 12,000 chars |

Allow-list per skill via `allowed_tools` frontmatter (defaults to all six if omitted).

## SKILL.md Format

```markdown
---
name: my-skill
description: One-line description shown in the palette
output: inline                   # or new-note (optional; defaults to global setting)
max_depth: 3                     # BFS link-walk depth (default 3, max 5)
max_tokens: 6000                 # token budget for linked notes (default = global)
mode: oneshot                    # or interactive (allows <ASK>...</ASK>)
agent: false                     # set true for tool-using skill
allowed_tools: [read_note, search_vault]   # optional allow-list for agent skills
max_rounds: 15                   # agent tool-call ceiling (default 10, hard cap 40)
auto_insert: false               # legacy: also auto-insert into note via runSkill
---

You are a senior <persona>. The user's vault context is provided below.

Do <thing>. Follow these rules: …

{{VAULT_CONTEXT}}
```

The `{{VAULT_CONTEXT}}` placeholder is replaced with the assembled XML-tagged context block (see `docs/modules/context-engine.md`). Agent skills can omit it if they have `get_active_note` or `read_note` in their tool grant — the model can fetch what it needs.

## YAML Parser (`src/yaml-mini.ts`)

The plugin uses a minimal dedicated YAML parser instead of `js-yaml` to keep the bundle small:

- Supports plain scalars, single/double quoted values, escape sequences, comments.
- Rejects ambiguous duplicate keys, malformed quotes, and invalid key characters.
- Returns `null` on parse failure (callers fall back to defaults).

## Related Docs

- docs/modules/context-engine.md — How `{{VAULT_CONTEXT}}` is populated.
- docs/api/llm-providers.md — Provider abstraction the SkillRunner / AgentLoop use.
- docs/auth/security.md — Skill-import path-traversal protections and the agent-write gate.
