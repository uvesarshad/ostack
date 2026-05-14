# UI System

> **Scope:** Describes the user interface components and Obsidian integration. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-14

## Overview

The UI system provides the entry points and feedback mechanisms for users. It uses native Obsidian components (Modals, Views, Notices) along with custom HTML/CSS for specialized inputs.

## Key Components

### FloatingInput (src/floating-input.ts)
- Purpose: A slash-command-like interface that appears over the editor.
- Responsibilities:
    - Filters available skills as the user types.
    - Triggers the SkillRunner on selection.

### SidebarView (src/sidebar-view.ts)
- Purpose: A dedicated Obsidian leaf/view for chat-like interactions or history.
- Responsibilities:
    - Displays active skill progress.
    - Shows a history of previous skill runs.
- AGENT SEE: src/persistent-bar.ts for the UI element that may dock or float this view.

### SettingsTab (src/settings.ts)
- Purpose: The configuration panel within Obsidian's settings menu.
- Responsibilities:
    - Manages API keys, model selections, and provider-specific hosts (e.g., Ollama).
    - Toggles features like Context Scout.

### Modals
- WelcomeModal (src/welcome-modal.ts): Shown on first install to guide the user through setup.
- ImportSkillModal (src/import-skill-modal.ts): Allows users to import SKILL.md files from external sources.

## User Feedback

- Notices: Used for transient messages (errors, success, "skill already running").
- Progress Indicators: Shown in the sidebar or floating bar during long-running tasks.

## Related Docs

- docs/architecture/execution-model.md — For details on the main thread execution.
- docs/ui/theming.md — How these components are styled using Obsidian variables.
