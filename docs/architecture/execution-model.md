# Execution Model

> **Scope:** Describes the plugin's execution environment within Obsidian. **Rendering context:** Client (Obsidian Main Thread) **Last updated:** 2026-05-15

## Overview

ogstack runs entirely within the Obsidian Electron renderer process (the "main thread" for plugins). It does not use background workers or sidecars, so it must prioritize non-blocking operations to keep the UI responsive. CLI providers spawn external subprocesses via `child_process` (desktop-only).

## Plugin Lifecycle

### Initialization (onload)
- `src/main.ts` is loaded by Obsidian.
- Loads persisted settings (`loadData`) and chat sessions (`ChatStore.load()` — migrates legacy chats from `data.json` to `_agent/chats/` sidecar markdown files).
- Constructs `SkillLoader` and registers a command per built-in skill plus any custom skill found under `_agent/`. The loader watches the `_agent/` folder via `app.vault.on("create"|"modify"|"delete"|"rename")` for hot-reload (debounced 300ms).
- Constructs the `BarChat` floating conversation surface and registers the global hotkey `Ctrl/Cmd+Shift+Space`.
- Registers commands: **Show AI bar**, **Import skill from GitHub**, **Manage installed skills**, plus one `gs: <Skill Name>` command per skill.
- Registers the right-sidebar view (`OgstackSidebarView`).
- Shows the welcome modal on first install (`data.hasSeenWelcome` flag).

### Termination (onunload)
- `SkillLoader.destroy()` unregisters all `gs:` commands and detaches vault watchers.
- `BarChat.destroy()` aborts any in-flight stream, clears the suggest-popup debounce timer, and removes its DOM container.
- The chat sidebar's `onClose` clears its `chatStore` subscription and the `relativeTime` minute-tick interval.

## Concurrency and Locking

### Per-Note Mutex
- `src/skill-runner.ts` maintains an in-memory `Map<notePath, true>` to prevent two skills with `output: inline` from racing on the same active note.
- Mutex is acquired only when `outputMode === "inline"`. `output: new-note` skills can run in parallel against the same source note.
- AGENT NOTE: If a skill is invoked on a note that's already locked, a Notice is shown and the new run is skipped.

### Streaming Cancellation
- Every API-provider stream owns an `AbortController`. The bar's stop button calls `abortController.abort()` which propagates to the underlying fetch.
- Claude `streamWithTools` combines the caller's signal with a 120s internal timeout — either source cancels.
- CLI provider streams kill the subprocess via `proc.kill()` in the generator's `finally` block.

### Parallel Execution
- Multiple skills can run in parallel if they target different notes OR if they use `new-note` output (separate target files, no contention).
- AGENT AVOID: Do not bypass the inline mutex in `src/output-router.ts` or `src/skill-runner.ts` — concurrent `editor.replaceRange` calls produce interleaved garbage.

## Agent Loop (Anthropic tool-use)

- `src/agent-loop.ts` runs a bounded streaming tool-use loop for skills with `agent: true`.
- Loop budget: `max_rounds` from SKILL.md frontmatter (default 10, hard ceiling 40). On exhaustion the loop yields a structured error event and returns.
- Each round: open a streaming request, fan out `text_delta` events live to the caller, buffer `tool_use` blocks (reassembled from `input_json_delta` chunks), then on `stop_reason: tool_use` execute the tools and append `tool_result` blocks for the next round.
- Tool calls and results are matched by Anthropic-issued `tool_use_id` — never by position or name (parallel calls to the same tool would alias otherwise).
- Write tools (`write_note`, `append_note`) check the `allowWrites` flag plumbed from settings; when off they return an error string the agent surfaces to the user.

## Streaming Granularity

- All API providers stream token-by-token via Server-Sent Events.
- Ollama streams NDJSON (one JSON object per line) from `/api/chat`.
- CLI providers stream stdout chunks: plain text for `claude-cli`/`gemini-cli`, JSONL for `codex-cli` (where we extract just the assistant-message deltas).
- The UI updates inside `requestAnimationFrame` to coalesce paints at most once per frame.

## Related Docs

- docs/architecture/data-flow.md — For the specific steps of skill execution.
- docs/api/llm-providers.md — For details on how different providers handle streaming and retry/backoff.
- docs/modules/skill-engine.md — For the agent loop's tool wiring.
