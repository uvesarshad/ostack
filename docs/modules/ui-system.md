# UI System

> **Scope:** Describes the user interface components and Obsidian integration. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-15

## Overview

The UI system provides four primary surfaces and a handful of modals. It uses native Obsidian primitives (Modal, ItemView, Notice, Setting) plus custom HTML/CSS for the chat surfaces. All icon-only buttons carry `aria-label`; suggest popups declare `role="listbox"` + `role="option"` + `aria-selected`; animations respect `prefers-reduced-motion: reduce`.

## Surfaces

### BarChat (`src/bar-chat.ts`)
- Floating bottom-center chat surface. The primary day-to-day interface.
- Hotkey: **Ctrl/Cmd + Shift + Space** (registered both via Obsidian's keymap and a DOM keydown fallback — Windows IME sometimes eats the Obsidian binding).
- States: `idle | streaming | waiting-ask | done | error` — drives stop/send button visibility and input disabled state.
- Surfaces:
  - Toolbar with title (and `· agent: /name` tag when sticky-agent), `+ New chat`, `Compact ↑`, `Open in sidebar`, `×` close.
  - Conversation pane rendering markdown via `MarkdownRenderer.render`.
  - Input row with autoresize textarea, suggest popup for `/` skills and `@` notes (debounced 70ms).
  - Per-bubble action buttons: **Insert at cursor**, **Append**, **Copy** (routed to the session's note, not the focused note).
  - ASK protocol: `<ASK>question</ASK>` tags render as inline answer textareas; submit re-enters the stream.
  - Compaction prompt appears in the toolbar when `estimated_tokens >= compactionThreshold` (default 8000).
- Subscribed to `ChatStore.onChange` and Obsidian's `workspace.on("active-leaf-change")` — follows the user's active note while idle, freezes during streaming.

### OgstackSidebarView (`src/sidebar-view.ts`)
- Right-sidebar `ItemView`. Lists chat sessions, drills into one.
- Sessions screen shows a list with `relativeTime` timestamps (auto-refreshed once per minute), delete buttons.
- Chat screen reuses `chat-runner.ts` for free-text flow; resolves `[[Note]]` mentions and inlines them.
- Re-renders are textarea-aware: snapshots value + selection + focus before `empty()` and restores after, so a cross-surface store change doesn't blow away typed input.

### FloatingInput (`src/floating-input.ts`)
- Centered progress overlay used as `ProgressReporter` for legacy `runSkill` flows (palette commands with `auto_insert: true`).
- Not used as a primary chat surface anymore — BarChat is the active path.

### Settings Tab (`src/settings.ts`)
- Sections: Provider, Context, Output, Agent safety.
- Provider section has progressive disclosure: API key field shows for API providers, Ollama host shows for Ollama, CLI path for CLI providers.
- Inline validation: rejects spaces / shell metacharacters in CLI path, restricts model name to `[a-zA-Z0-9._:\-/]`.
- **Test connection** button sends a one-token ping and surfaces ok / warning / error inline.
- Agent safety section hosts the **Allow agent file writes** toggle (default off).

## Modals

| Modal | Source | Trigger |
|---|---|---|
| WelcomeModal | `welcome-modal.ts` | First install (`!data.hasSeenWelcome`) |
| ImportSkillModal | `import-skill-modal.ts` | Command: `ogstack: Import skill from GitHub`. Validates skill names against `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$` before writing to `_agent/`. |
| ManageSkillsModal | `manage-skills-modal.ts` | Command: `ogstack: Manage installed skills`. Lists `_agent/*` skills with open/delete buttons; `confirm()` guard before deletion. |

## Streaming Status Indicator

- `src/main.ts` registers a status-bar item via `addStatusBarItem()`.
- When the bar is hidden but a stream is active, the indicator shows three pulsing dots + the skill name. Tapping it currently does nothing (planned: refocus bar).

## User Feedback

- **Notices**: transient corner toasts (`new Notice(message)`) for errors, success, "skill already running on this note", etc.
- **In-chat error bubbles**: stream failures and round-limit exhaustion render as styled blocks (`.gstack-bar2-msg-error`, `.gstack-bar2-agent-limit`).
- **Progress overlay**: legacy `FloatingInput` used by `skill-runner` for `auto_insert` commands.

## Related Docs

- docs/architecture/execution-model.md — Plugin lifecycle and concurrency.
- docs/state/app-state.md — How session and streaming state is partitioned.
- docs/ui/theming.md — CSS variables and reduced-motion handling.
- docs/ui/component-library.md — Reusable primitives.
