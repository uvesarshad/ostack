# App State

> **Scope:** How runtime state is partitioned and synchronized across UI surfaces. **Rendering context:** Client (Obsidian Main Thread) **Last updated:** 2026-05-15

## Overview

ogstack uses no state-management library. State lives in four containers:

1. **Settings** — persisted to `data.json`, read synchronously.
2. **Chat sessions** — persisted to `_agent/chats/*.md`, mirrored in-memory.
3. **Streaming + UI state** — transient, owned by the active surface (`BarChat` or `OgstackSidebarView`).
4. **Inline-output mutex** — in-memory `Map<notePath, true>` to serialize concurrent writes.

UI surfaces subscribe to the chat store's `onChange` notifier; settings changes flow back through `saveSettings()` which calls `bar?.updateSettings(...)`.

## State Containers

### Settings (`src/settings.ts`)

| Property | Where | Mutation path |
|---|---|---|
| `GStackSettings` shape | `GStackPlugin.settings` | Settings tab UI → `saveSettings()` → `loadData/saveData` |

- Read synchronously anywhere via the plugin handle.
- On save, the bar's local `settings` reference is refreshed so the next stream picks up new credentials immediately (no restart needed for most fields).

### Chat Store (`src/chat-store.ts`)

| Property | Shape |
|---|---|
| `sessions: ChatSession[]` | In-memory mirror of `_agent/chats/*.md`. |
| `sessionPaths: Map<sessionId, filePath>` | Reverse lookup for writes / deletes. |
| `listeners: Set<() => void>` | Subscribers (bar + sidebar). |

**Subscriber pattern:**
```ts
const unsubscribe = chatStore.onChange(() => { /* re-render */ });
// later: unsubscribe();
```

**Mutations always go through the store** so subscribers fire and the markdown sidecar stays current:
- `createSession`, `addMessage`, `updateLastAssistantMessage`, `replaceSessionMessages`, `deleteSession`, `setAgentSkill`.

**Sticky agent state:** `ChatSession.agentSkillName` is the durable signal that follow-up user messages should re-enter the agent loop. Survives reload via the sidecar's YAML frontmatter.

### BarChat streaming state (transient, not persisted)

| Field | Purpose |
|---|---|
| `state: "idle" \| "streaming" \| "waiting-ask" \| "done" \| "error"` | Drives stop/send button visibility and input disabled state. |
| `streamingAssistantEl` | Live DOM bubble being filled by the current stream. |
| `streamingContent` | Accumulated text for the in-flight turn. |
| `currentSkill` | Skill that initiated the current run (null for free chat). |
| `currentSystemPrompt` | Cached system prompt with VAULT_CONTEXT already substituted. |
| `currentSystemPromptForNote` | The active-note path the cached prompt was built for. Used to detect note changes and rebuild. |
| `abortController` | Per-stream abort handle. |
| `currentSessionId` | Active chat session (from the store). |
| `filteredEntries / selectedSuggestIdx / triggerPos` | Suggest-popup transient state. |
| `suggestDebounceTimer` | 70ms debounce for the `@`/`/` filter. |

Cleared on `+ New chat` and on `destroy()`.

### Sidebar streaming state

| Field | Purpose |
|---|---|
| `screen: { name: "sessions" } \| { name: "chat", sessionId }` | Current view. |
| `streamingContent` | Same role as bar's. |
| `storeUnsubscribe` | Cleared on `onClose`. |
| `relativeTimeInterval` | 1-minute tick that refreshes timestamp spans in place. |

### Inline-output mutex (`src/skill-runner.ts`)

A module-scoped `Map<notePath, true>`. Acquired only when `outputMode === "inline"`. If a user tries to run a second inline skill on the same note, a Notice fires and the run is skipped. New-note skills bypass entirely.

### Skill loader command registry (`src/skill-loader.ts`)

| Field | Purpose |
|---|---|
| `registeredSkills: Map<name, Skill>` | Currently-registered skills (built-in + custom). |
| `unregisterFns: Map<name, () => void>` | Per-command teardown closures used on file delete / rename / plugin unload. |
| `builtinNames: Set<string>` | Used to detect conflicts when a custom skill tries to overshadow a built-in. |
| `debounceTimer` | 300ms debounce for `_agent/` file events. |

## State Synchronization Patterns

### Cross-surface chat updates
1. User types in the bar → `addMessage` → store mutates → notifies subscribers.
2. The sidebar (if open) receives the notification → re-renders that session.
3. The bar re-renders its own conversation pane (skipping if mid-stream).

### Textarea preservation on rerender
The sidebar snapshots textarea value + selection + focus before `root.empty()` and restores after — see `OgstackSidebarView.render()`.

### Active-note follow
`workspace.on("active-leaf-change")` is subscribed by `BarChat`. When idle, switching notes re-attaches the bar to that note's most recent session (or creates a new one).

## Related Docs

- docs/api/storage.md — Persistence layer beneath the in-memory state.
- docs/modules/ui-system.md — Surfaces that consume this state.
- docs/architecture/execution-model.md — Mutex semantics.
