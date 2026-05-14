# Layout System

> **Scope:** Describes how the plugin fits into the Obsidian workspace. **Rendering context:** Client (Obsidian UI) **Last updated:** 2026-05-14

## Overview

ogstack integrates with the Obsidian layout system by registering custom views and using the editor API to manipulate active note content.

## Workspace Integration

### Sidebar Leaf
- The plugin registers a custom View type that can be docked in the left or right sidebar.
- AGENT OWNER: src/sidebar-view.ts
- AGENT SEE: docs/modules/ui-system.md#sidebarview

### Editor Overlay
- The FloatingInput component is absolutely positioned over the active editor leaf.
- It uses the Obsidian editor interface to determine the cursor coordinates for initial placement.

### New Note Creation
- When a skill is in "new-note" mode, the OutputRouter uses the Obsidian Workspace API to create a new file in the same folder as the active note and immediately opens it in a new leaf or split.

## Data Fetching at Layout Level

- Settings are loaded globally during the plugin's initialization and made available to all components via the GStackSettings object.
- Vault metadata is fetched on-demand when a skill is triggered, using the global app instance.

## Related Docs

- docs/architecture/execution-model.md — For more on the main thread lifecycle.
- docs/ui/component-library.md — For details on the individual components.
