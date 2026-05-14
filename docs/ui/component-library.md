# Component Library

> **Scope:** Lists shared UI components and their properties. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-14

## Overview

ogstack uses a mix of custom TypeScript-managed HTML elements and standard Obsidian API components. All components are styled via styles.css.

## Shared Components

### FloatingInput (src/floating-input.ts)
- Props:
    - skills: A list of available skill objects to display.
    - onSelect: Callback triggered when a user chooses a skill.
- Interaction: Listens for keyboard navigation (arrows, enter) and click events.

### PersistentBar (src/persistent-bar.ts)
- Props:
    - status: Current state of the engine (idle, running, streaming).
    - progress: Numerical value (0-100) for long tasks.
- Interaction: Can be clicked to open the sidebar or cancel an active task.

### SkillCard (src/sidebar-view.ts)
- Props:
    - name: Title of the skill.
    - description: One-line summary.
- Usage: Displayed within the sidebar to show history or available skills.

### ProviderSelector (src/settings.ts)
- Props:
    - current: The currently active provider (Claude, OpenAI, etc.).
- Purpose: A dropdown within the settings tab to switch LLM backends.

## Related Docs

- docs/modules/ui-system.md — Higher-level overview of these components.
- docs/ui/theming.md — How components are styled.
