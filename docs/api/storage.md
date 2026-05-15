# Storage and Persistence

> **Scope:** Describes how the plugin persists data and interacts with the vault. **Rendering context:** Isomorphic **Last updated:** 2026-05-15

## Overview

ogstack has no external database. It uses three storage surfaces:

1. **Plugin data file** (`data.json`) — settings.
2. **Chat sidecar files** under `_agent/chats/` — one markdown file per chat session.
3. **Skill files** under `_agent/` — custom user-authored skills (built-in skills are embedded in the bundle).

Vault metadata (link graph, mtime) is read through Obsidian's `MetadataCache`, not the filesystem directly.

## Plugin Settings (`data.json`)

- **Location:** `.obsidian/plugins/ogstack/data.json`.
- **Format:** plaintext JSON (the shape mirrors the `GStackSettings` interface in `src/settings.ts`).
- **Loaded by:** `loadData()` in `GStackPlugin.loadSettings`. Merges over `DEFAULT_SETTINGS`.
- **Saved by:** `saveData()` in `saveSettings` — called after any settings UI mutation.
- **AGENT NOTE:** API keys are stored plaintext. Obsidian Sync excludes plugin data by default; third-party sync (Git, Dropbox, iCloud) carries the file unless explicitly excluded. The settings UI surfaces this disclaimer.

### Settings shape (abbreviated)

```ts
interface GStackSettings {
  provider: "claude" | "openai" | "gemini" | "ollama" | "grok"
            | "claude-cli" | "codex-cli" | "gemini-cli";
  apiKey: string;
  model: string;
  ollamaHost: string;
  cliPath: string;
  maxTokens: number;
  outputMode: "inline" | "new-note";
  scoutEnabled: boolean;
  scoutModel: string;
  scoutProvider: ProviderId | "inherit";
  scoutApiKey: string;
  scoutCliPath: string;
  scoutOllamaHost: string;
  contextDecayDays: number;
  compactionThreshold: number;
  allowAgentWrites: boolean;   // off by default — agent write_note/append_note refuse when false
}
```

Plus a `hasSeenWelcome` boolean toggled by the first-run modal.

## Chat Store (`src/chat-store.ts`)

Chat sessions live as standalone markdown files in `_agent/chats/`. Each session is one file: `<note-slug>__<sessionId>.md`. Benefits:

- Writes touch a small file (not a 10 MB blob).
- Chats are visible / searchable inside Obsidian.
- Obsidian Sync ships only the changed file.

### File format

```markdown
---
ogstack: chat
id: <unique session id>
notePath: Notes/idea.md
noteTitle: "idea"
createdAt: 1715800000000
updatedAt: 1715800020000
agentSkillName: vault-agent    # present only when session is sticky-agent
---

<!-- ogstack:msg role=user time=1715800001000 -->
hello

<!-- ogstack:msg role=assistant time=1715800002000 -->
<!-- ogstack:tools
[{"id":"toolu_…","name":"read_note","input":{"path":"x.md"},"output":"…","isError":false}]
-->
the answer
```

- The `ogstack:msg` comment delimits message boundaries (role + timestamp).
- The optional `ogstack:tools` comment block immediately after the header carries persisted agent tool calls for that turn.
- `agentSkillName` makes the session sticky-agent — free-text follow-ups re-enter the agent loop with that skill.

### Load behavior

- `ChatStore.load()` first runs a one-time migration: any legacy `chatSessions` array in `data.json` is split into per-session sidecar files, then removed from `data.json`.
- `scanFolder()` reads all `*.md` files in `_agent/chats/` **in parallel** via `Promise.allSettled` and parses them via the shared `parseYamlFrontmatter` helper.

### Mutations

- `createSession(notePath, title)` — writes a new file.
- `addMessage(sessionId, role, content, toolCalls?)` — appends and rewrites the file.
- `setAgentSkill(sessionId, name?)` — toggles stickiness.
- `replaceSessionMessages` — used by compaction.
- `deleteSession(id)` — removes the file.
- All mutations notify subscribers via `onChange(fn)`.

## Skill Definitions

| Location | Source | Hot reload |
|---|---|---|
| `src/builtin-skills.ts` | Embedded in bundle | No (requires plugin reload) |
| `_agent/<name>/SKILL.md` | Vault, folder-form | Yes (300ms debounce) |
| `_agent/<name>.md` | Vault, flat form | Yes |

Built-in skills are NOT in the user's vault. `skills/<name>/SKILL.md` files in the repo are documentation mirrors only.

## Vault Metadata Access

`app.metadataCache.resolvedLinks[notePath]` provides the link graph used by BFS. `app.vault.cachedRead(file)` reads file contents from Obsidian's cache (avoids stat + open). File mtime comes from `file.stat.mtime`.

## Related Docs

- docs/modules/context-engine.md — How metadata is used to score notes.
- docs/modules/skill-engine.md — Skill loader hot-reload behavior.
- docs/infra/environment.md — Full settings field reference.
- docs/state/app-state.md — In-memory state shape.
