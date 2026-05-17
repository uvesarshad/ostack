# Layout System

> Scope: Workspace leaves, body-level absolute overlays, and workspace event systems.
> Rendering context: Client
> Project tier: 3
> Last updated: 2026-05-17

## Overview
ogstack registers multiple view spaces inside Obsidian's workspace framework. It divides user interactions between a long-lived sidebar leaf panel, a globally accessible floating command bar, modal dialogs, and a settings tab.

## View containers

### Sidebar Leaf View
- View Type: SIDEBAR_VIEW_TYPE, resolved as ogstack-sidebar.
- Class: OgstackSidebarView in sidebar-view.ts.
- Location: Placed inside the workspace right sidebar leaf. It offers a persistent dashboard listing active note history, chat message bubbles, and action buttons. It detaches and attaches dynamically via active-leaf queries.

### Floating Command Bar
- Class: BarChat in bar-chat.ts.
- Location: Appended directly to document.body. Renders as an absolutely positioned, centered card overlay. It remains hidden until summoned, serving as a rapid keyboard-driven interface.

### Settings Panel Tab
- Class: GStackSettingTab in settings.ts.
- Location: Placed inside Obsidian's Settings dashboard, providing text fields, dropdown selectors, toggles, and verification triggers.

## Event Listeners and Bindings
- Keyboard Hotkey listener: Registers Mod+Shift+Space command in main.ts. Since Windows IME often consumes this event, main.ts registers a secondary window-level DOM keydown listener to capture Ctrl+Shift+Space or Cmd+Shift+Space globally and toggle focus on the floating input textarea.
- Workspace Note Switch tracker: Listens to Obsidian's active-leaf-change workspace event. When an editor is switched, the bar-chat and sidebar-view capture the active note, auto-attach to the most recent conversation session for that note, and trigger re-renders.

## Update Triggers
- When a new view leaf or overlay container is introduced.
- When keydown hotkeys or keyboard listeners are changed.
- When workspace event bindings are added or refactored.

AGENT UPDATE: update docs/ui/layout-system.md when workspace leaves, layout classes, or window keyboard bindings change.

## Related Docs
- docs/overview.md — General tech stack.
- docs/ui/component-library.md — Modals and inputs.
- docs/state/app-state.md — Workspace note state tracking.
