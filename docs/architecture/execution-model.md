# Execution Model

> **Scope:** Describes the plugin's execution environment within Obsidian. **Rendering context:** Client (Obsidian Main Thread) **Last updated:** 2026-05-14

## Overview

ogstack runs entirely within the Obsidian Electron renderer process (the "main thread" for plugins). It does not use background workers or sidecars, so it must prioritize non-blocking operations to keep the UI responsive.

## Plugin Lifecycle

### Initialization (onload)
- The main.ts module is loaded by Obsidian.
- It initializes the GStackSettings, SkillLoader, and registers the global command palette items.
- It sets up vault watchers to monitor changes to the .gstack/skills/ directory for hot-reloading.

### Termination (onunload)
- The plugin unregisters all commands and event listeners.
- Any active streams or per-note mutexes are cleared to prevent memory leaks.

## Concurrency and Locking

### Per-Note Mutex
- To prevent multiple skills from writing to the same note at the same time, the system uses a locking mechanism in src/main.ts.
- AGENT NOTE: If a skill attempt is made on a note that is already "locked," a Notice is shown and the skill is skipped.

### Parallel Execution
- Multiple skills can run in parallel if they target different notes or if they are in "new-note" output mode.
- AGENT AVOID: Do not attempt to bypass the mutex in src/output-router.ts as it will lead to race conditions in the Obsidian editor state.

## Streaming Granularity

- Streaming happens at the sentence or chunk level depending on the provider.
- Claude and OpenAI provide tokens immediately, while Gemini may wait for sentence-level completion in some configurations.
- The UI remains interactive during streaming because the plugin uses asynchronous fetch and requestAnimationFrame for editor updates.

## Related Docs

- docs/architecture/data-flow.md — For the specific steps of skill execution.
- docs/api/llm-providers.md — For details on how different providers handle streaming.
