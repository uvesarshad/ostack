# Component Library

> **Scope:** Reusable UI primitives and the four primary surfaces. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-15

## Overview

ogstack uses custom TypeScript-managed DOM (no React) plus standard Obsidian primitives (`Modal`, `Setting`, `Notice`, `PluginSettingTab`, `ItemView`). All visuals live in `styles.css` (section-indexed at the top).

## Primary Surfaces

### BarChat (`src/bar-chat.ts`)
- **Role:** Floating bottom-center chat. Primary day-to-day surface.
- **DOM tree:**
  ```
  .gstack-bar2-container
    .gstack-bar2-popup            (role="listbox")
    .gstack-bar2-card
      .gstack-bar2-toolbar
        .gstack-bar2-toolbar-title (+ .gstack-bar2-toolbar-agent-tag when sticky-agent)
        button × 4 (new chat / compact / open in sidebar / close)
      .gstack-bar2-conversation
        .gstack-bar2-msg.gstack-bar2-msg-{user|assistant|status}
      .gstack-bar2-input-row
        textarea.gstack-bar2-input
        button.gstack-bar2-send / .gstack-bar2-stop
  ```
- **Per-message actions:** Insert at cursor / Append / Copy buttons under every assistant bubble.
- **State data-attribute:** `card.dataset.state` is set to one of `idle | streaming | waiting-ask | done | error` for CSS hooks.
- **Hotkey:** Ctrl/Cmd + Shift + Space.

### OgstackSidebarView (`src/sidebar-view.ts`)
- **Role:** Right-sidebar `ItemView`.
- **Two screens:** `sessions` (list of all chats) and `chat` (selected session).
- **Session items** have `role="button"` + `tabindex="0"` + Enter/Space keyboard activation.

### Settings Tab (`src/settings.ts`)
- **Role:** Configuration. Sections: Provider, Context, Output, Agent safety.
- **Progressive disclosure:** API key, Ollama host, CLI path show / hide based on `provider` selection. Scout fields hide when `scoutProvider === "inherit"`.
- **Inline validation:** `cliPath` and `model` blocks invalid input with a `mod-warning` class on the row.
- **Test connection** button sends a one-token ping and writes the result into `.gstack-test-connection-result`.

### FloatingInput (`src/floating-input.ts`)
- **Role:** Legacy progress overlay. Used by `runSkill` (palette commands with `auto_insert: true`) as the `ProgressReporter` implementation.
- **Not the primary chat surface anymore** — BarChat replaced it.

## Modal Components

| Component | Source | Trigger |
|---|---|---|
| WelcomeModal | `welcome-modal.ts` | First install. Lists getting-started steps, built-in skills, chat sidebar, custom skills folder location (`_agent/`). |
| ImportSkillModal | `import-skill-modal.ts` | "Import skill from GitHub" command. Two-step UX: paste URL → single import OR scan repo. |
| ManageSkillsModal | `manage-skills-modal.ts` | "Manage installed skills" command. Lists `_agent/*` skills with **Open** and **Delete** buttons; uses `confirm()` before delete. |

## Reusable Patterns

### Suggest popup (skills + notes)
- Both bar and sidebar render the same shape: each item is `role="option"` with `aria-selected`.
- Keyboard navigation: Arrow / Enter / Escape (handled inline by each surface).
- Filter is debounced 70ms — `@` filter walks every vault file via `app.vault.getFiles()`, so debouncing matters in large vaults.

### ASK protocol (`<ASK>question</ASK>`)
- Triggered by interactive-mode skills (`mode: interactive` in SKILL.md).
- Rendered as inline textareas under the assistant bubble. Submit answers re-enters the stream as a new user message.

### Status bar streaming indicator
- `addStatusBarItem()` slot. Shows three pulsing dots (`.dot`) + skill label when streaming with the bar hidden.

### Agent round-limit error block
- When `runClaudeAgent` exhausts `max_rounds`, the bar renders `.gstack-bar2-agent-limit` with a title + detail line, distinct from a tiny red error span.

## Class Naming Conventions

| Prefix | Surface |
|---|---|
| `.gstack-bar2-*` | BarChat |
| `.gstack-chat-*`, `.gstack-session-*`, `.gstack-msg-*` | OgstackSidebarView |
| `.gstack-fi-*` | FloatingInput (progress overlay) |
| `.gstack-welcome-*` | WelcomeModal |
| `.gstack-import-*` | ImportSkillModal |
| `.gstack-manage-skills-*` | ManageSkillsModal |
| `.gstack-test-connection-*` | Settings test button result |
| `.gstack-api-disclaimer`, `.gstack-hidden` | Settings utilities |
| `.gstack-statusbar-*` | Status bar indicator |

## Related Docs

- docs/modules/ui-system.md — Higher-level surface overview.
- docs/ui/theming.md — CSS variables and reduced-motion handling.
- docs/ui/layout-system.md — Sizing and positioning strategy.
