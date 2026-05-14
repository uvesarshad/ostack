# App State

> **Scope:** Describes the management of client-side state within the plugin. **Rendering context:** Client (Obsidian Main Thread) **Last updated:** 2026-05-14

## Overview

State in ogstack is handled through simple store patterns and Obsidian's built-in settings management. There is no heavy state management library like Redux or Zustand; instead, the plugin uses native TypeScript objects and event emitters.

## State Containers

### Settings Store (src/settings.ts)
- Purpose: The source of truth for all user configurations.
- Access: Synchronous read from the plugin's settings property.
- Updates: Asynchronous write via the saveSettings() method, which triggers a reload of relevant modules.

### Chat Store (src/chat-store.ts)
- Purpose: Tracks the history of skill executions and their results.
- Components: Subscribed to by the SidebarView to show a list of recent runs.
- Persistence: Currently session-based (resets on plugin reload).

### Execution Mutex (src/main.ts)
- Purpose: A boolean flag per note that tracks whether a skill is currently running.
- AGENT SEE: docs/architecture/execution-model.md#per-note-mutex

## State Synchronization

- UI components (like the SidebarView or PersistentBar) re-render in response to events emitted by the SkillRunner or ChatStore.
- Skills are hot-reloaded when the SkillLoader detects a file change in the vault, updating the global command palette state.

## Related Docs

- docs/modules/ui-system.md — How the UI reacts to state changes.
- docs/api/storage.md — How the settings state is persisted to disk.
