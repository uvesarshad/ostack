# Application State Management

> Scope: Client state machines, settings persistence, workspace listeners, and subscriber interfaces.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack manages state completely inside the client application memory. State is divided into persistent settings (saved in a JSON file), a cache of chat conversations (synced from Markdown sidecars), active session trackers, and transient streaming variables.

## Key State Containers

### User Settings
- Class: GStackSettings defined in settings.ts.
- Lifetime: Persistent.
- Persistence Mechanism: Loaded via loadData and written using saveData on GStackPlugin startup and tab setting edits, flushing to data.json.
- Properties: Holds the chosen API provider, models, custom CLI paths, token budgets, Context Scout toggles, and allowAgentWrites options.

### Chat Memory Cache
- Class: ChatStore defined in chat-store.ts.
- Lifetime: Kept in memory, synchronized with local Markdown sidecars on note modification, creation, or deletion.
- Methods: manages session creation, adding user and assistant message records, persisting tool outputs, and directory purging.

### Workspace Session Tracking
- Properties: Managed inside BarChat and OgstackSidebarView via currentSessionId.
- Sync Rules: When the active editor sheet shifts, workspace event listeners capture the new note and look up its most recent session. If none exists, they call createSession to spawn a new one, updating currentSessionId.

### Transient Streaming State
- Properties: Variables like state (idle, streaming, waiting-ask, done, error), streamingContent, currentSkill, currentSystemPrompt, and abortController.
- Lifetime: Transient. Cleared when the active conversation completes or is stopped by the user.

## State Listeners and Subscriptions
- Event Notification: ChatStore maintains a listeners set containing callback handlers.
- Subscription: UI components register themselves by calling chatStore.onChange(callback).
- State Updates: When a message or turn is added to the store, notify triggers, calling all callbacks. The views execute incremental rendering to append message elements without destroying typed textarea buffers.

## Update Triggers
- When new settings properties are added to settings.ts.
- When the state interface or method signatures are refactored in chat-store.ts.
- When new subscription mechanisms or listener events are registered.

AGENT UPDATE: update docs/state/app-state.md when settings variables, state models, or subscriber patterns change.

## Related Docs
- docs/overview.md — Glossary and tech stack.
- docs/api/storage.md — Markdown sidecar structures.
- docs/modules/ui-system.md — Progressive DOM updates.
